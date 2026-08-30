#!/usr/bin/env python3
"""
細切れの動画を1本に結合し、動きのない区間をカットするツール。

使い方:
    python3 merge_trim_video.py "/Volumes/NO NAME/record/2026/08/30" -o ~/Desktop/merged.mp4

必要なもの: ffmpeg / ffprobe (brew install ffmpeg)
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor

VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".mts", ".m2ts", ".avi", ".mkv", ".mpg", ".mpeg", ".wmv", ".ts"}

# 「変化したセルの割合(%)」がこれ未満なら実質静止とみなす
STILL_FLOOR = 0.15

try:
    import numpy as np
except ImportError:
    np = None


def run(cmd, **kw):
    return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kw)


def need(tool):
    if shutil.which(tool) is None:
        sys.exit(f"エラー: {tool} が見つかりません。`brew install ffmpeg` を実行してください。")


def natural_key(path):
    """file2.mp4 が file10.mp4 より前に来るような並び順。"""
    name = os.path.basename(path)
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", name)]


def collect_inputs(paths, recursive, sort_mode):
    files = []
    for p in paths:
        if os.path.isdir(p):
            if recursive:
                for root, _, names in os.walk(p):
                    files += [os.path.join(root, n) for n in names]
            else:
                files += [os.path.join(p, n) for n in sorted(os.listdir(p))]
        else:
            files.append(p)
    files = [f for f in files
             if os.path.splitext(f)[1].lower() in VIDEO_EXTS
             and not os.path.basename(f).startswith("._")]
    if sort_mode == "time":
        files.sort(key=lambda f: (os.path.getmtime(f), natural_key(f)))
    else:
        files.sort(key=natural_key)
    return files


def probe(path):
    r = run(["ffprobe", "-v", "error", "-print_format", "json",
             "-show_streams", "-show_format", path])
    if r.returncode != 0:
        return None
    info = json.loads(r.stdout or b"{}")
    v = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
    if v is None:
        return None
    fps = 30.0
    for key in ("avg_frame_rate", "r_frame_rate"):
        val = v.get(key, "0/0")
        try:
            num, den = val.split("/")
            if float(den) > 0 and float(num) > 0:
                fps = float(num) / float(den)
                break
        except ValueError:
            pass
    try:
        duration = float(info.get("format", {}).get("duration", 0.0))
    except (TypeError, ValueError):
        duration = 0.0
    return {
        "path": path,
        "width": int(v.get("width") or 0),
        "height": int(v.get("height") or 0),
        "fps": fps,
        "duration": duration,
        "has_audio": any(s.get("codec_type") == "audio" for s in info.get("streams", [])),
    }


# ---------------------------------------------------------------- 動き解析

def motion_series(path, sample_fps, grid_w, grid_h, cell_threshold):
    """各サンプル間で「何 % のセルが変化したか」を返す。

    画面全体の平均差分ではなくセル単位の変化数を数えるので、
    広い画角の中で被写体だけが動くような映像でも動きを拾える。
    """
    cmd = ["ffmpeg", "-v", "error", "-i", path,
           "-vf", f"fps={sample_fps},scale={grid_w}:{grid_h},format=gray",
           "-f", "rawvideo", "-pix_fmt", "gray", "-"]
    size = grid_w * grid_h
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    diffs, prev = [], None
    try:
        while True:
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            if prev is not None:
                if np is not None:
                    a = np.frombuffer(prev, dtype=np.uint8).astype(np.int16)
                    b = np.frombuffer(buf, dtype=np.uint8).astype(np.int16)
                    changed = int(np.count_nonzero(np.abs(a - b) > cell_threshold))
                else:
                    changed = 0
                    for x, y in zip(prev, buf):
                        d = x - y
                        if d > cell_threshold or -d > cell_threshold:
                            changed += 1
                diffs.append(changed * 100.0 / size)
            prev = buf
    finally:
        proc.stdout.close()
        proc.wait()
    return diffs


def percentile(values, pct):
    if not values:
        return 0.0
    s = sorted(values)
    idx = min(len(s) - 1, max(0, int(round((len(s) - 1) * pct / 100.0))))
    return s[idx]


def auto_threshold(diffs):
    """変化量の分布から「静止」と「動き」の境目を推定する。

    この指標では静止＝ほぼ 0% なので、静止側の代表値が実際に 0 付近にある
    ときだけ「静止区間が存在する」と判断し、静止側と動き側の間を取る。
    最も静かな瞬間ですら動いている映像は、全編動きとみなして全部残す。
    """
    if not diffs:
        return STILL_FLOOR, 0.0, 0.0
    lo = percentile(diffs, 10)   # 静止側の代表値
    hi = percentile(diffs, 90)   # 動き側の代表値

    if lo > STILL_FLOOR * 3:
        # 一番静かな瞬間にも動きがある = 全編動き → 全部残す
        return max(lo * 0.9, STILL_FLOOR / 3), lo, hi
    if hi < STILL_FLOOR * 2:
        # 動き側も 0 付近 = 全編静止 → 何も残さない
        return STILL_FLOOR, lo, hi
    return max(lo + 0.25 * (hi - lo), STILL_FLOOR), lo, hi


def build_segments(diffs, sample_fps, duration, threshold, pad, merge_gap, min_len):
    """動きのあるサンプルから (開始秒, 終了秒) の残す区間リストを作る。"""
    step = 1.0 / sample_fps
    raw = []
    for i, d in enumerate(diffs):
        if d >= threshold:
            # diffs[i] は i 番目と i+1 番目のサンプル間の変化
            raw.append((i * step, (i + 2) * step))
    if not raw:
        return []

    segs = []
    for start, end in raw:
        start = max(0.0, start - pad)
        end = min(duration, end + pad) if duration > 0 else end + pad
        if segs and start <= segs[-1][1] + merge_gap:
            segs[-1][1] = max(segs[-1][1], end)
        else:
            segs.append([start, end])
    return [(s, e) for s, e in segs if e - s >= min_len]


# ---------------------------------------------------------------- 書き出し

def pick_encoder(mode, target):
    """使えるハードウェアエンコーダを実際に試してから選ぶ。"""
    if mode == "libx264":
        return "libx264"
    listed = run(["ffmpeg", "-v", "error", "-hide_banner", "-encoders"]).stdout.decode(
        "utf-8", "replace")
    if "h264_videotoolbox" not in listed:
        if mode == "videotoolbox":
            sys.exit("エラー: h264_videotoolbox がこの ffmpeg では使えません。")
        return "libx264"
    # 実際に1秒だけエンコードして動作確認する（使えなければ libx264 に戻す）
    w, h, _ = target
    probe_cmd = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi",
                 "-i", f"color=c=black:s={w}x{h}:d=1:r=10", "-c:v", "h264_videotoolbox",
                 "-f", "null", "-"]
    if run(probe_cmd).returncode == 0:
        return "h264_videotoolbox"
    if mode == "videotoolbox":
        sys.exit("エラー: h264_videotoolbox での試験エンコードに失敗しました。")
    return "libx264"


def video_args(encoder, target, crf, preset):
    if encoder == "h264_videotoolbox":
        w, h, fps = target
        # 解像度と fps から妥当なビットレートを決める (約 0.10 bit/pixel)
        bitrate = min(max(int(w * h * fps * 0.10), 2_000_000), 20_000_000)
        return ["-c:v", "h264_videotoolbox", "-b:v", str(bitrate)]
    return ["-c:v", "libx264", "-preset", preset, "-crf", str(crf)]


def encode_segment(src, start, end, dst, target, has_audio, crf, preset, encoder):
    w, h, fps = target
    vf = (f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
          f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps},format=yuv420p")

    def attempt(enc):
        cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.3f}", "-i", src]
        if not has_audio:
            cmd += ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"]
        cmd += ["-t", f"{max(end - start, 0.05):.3f}",
                "-map", "0:v:0", "-map", ("0:a:0" if has_audio else "1:a:0"), "-vf", vf]
        cmd += video_args(enc, target, crf, preset)
        cmd += ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
                "-video_track_timescale", "90000", "-shortest", dst]
        return run(cmd)

    r = attempt(encoder)
    if r.returncode != 0 and encoder != "libx264":
        r = attempt("libx264")          # ハードウェアで失敗したらソフトで再試行
    if r.returncode != 0:
        sys.stderr.write(r.stderr.decode("utf-8", "replace"))
    return r.returncode == 0


def hms(sec):
    sec = round(max(0.0, sec), 1)
    h, rest = divmod(sec, 3600)
    m, s = divmod(rest, 60)
    return f"{int(h):d}:{int(m):02d}:{s:04.1f}"


def main():
    ap = argparse.ArgumentParser(
        description="細切れ動画を結合し、動きのない区間をカットする")
    ap.add_argument("inputs", nargs="+", help="動画のあるフォルダ、または動画ファイル")
    ap.add_argument("-o", "--output", default="merged.mp4", help="出力ファイル (既定: merged.mp4)")
    ap.add_argument("-r", "--recursive", action="store_true", help="サブフォルダも探す")
    ap.add_argument("--sort", choices=["name", "time"], default="name", help="並び順 (既定: name)")
    ap.add_argument("--threshold", default="auto",
                    help="動き判定のしきい値(変化セルの%%)。auto または数値。大きいほど多くカット")
    ap.add_argument("--pad", type=float, default=0.7, help="動きの前後に残す秒数 (既定: 0.7)")
    ap.add_argument("--merge-gap", type=float, default=1.5,
                    help="この秒数以下の静止は繋げて残す (既定: 1.5)")
    ap.add_argument("--min-len", type=float, default=0.5,
                    help="これより短い区間は捨てる (既定: 0.5)")
    ap.add_argument("--sample-fps", type=float, default=4.0, help="解析のサンプリングfps (既定: 4)")
    ap.add_argument("--grid-width", type=int, default=64,
                    help="解析用の縮小幅。小さい被写体が写らない場合は増やす (既定: 64)")
    ap.add_argument("--cell-threshold", type=int, default=12,
                    help="1セルが変化したとみなす明度差 (既定: 12)")
    ap.add_argument("-j", "--jobs", type=int, default=0,
                    help="並列数 (既定: CPU数と4の小さい方)")
    ap.add_argument("--encoder", choices=["auto", "libx264", "videotoolbox"], default="auto",
                    help="映像エンコーダ (既定: auto = Mac ならハードウェア)")
    ap.add_argument("--analyze", action="store_true",
                    help="各ファイルの変化量の分布だけを表示する（しきい値の調整用）")
    ap.add_argument("--no-trim", action="store_true", help="カットせず結合だけする")
    ap.add_argument("--dry-run", action="store_true", help="解析結果だけ表示して書き出さない")
    ap.add_argument("--crf", type=int, default=20, help="画質 (小さいほど高画質・既定: 20)")
    ap.add_argument("--preset", default="veryfast", help="x264 preset (既定: veryfast)")
    ap.add_argument("--size", help="出力解像度 例: 1920x1080 (既定: 最初の動画に合わせる)")
    ap.add_argument("--fps", type=float, help="出力fps (既定: 最初の動画に合わせる)")
    args = ap.parse_args()

    need("ffmpeg")
    need("ffprobe")
    jobs = args.jobs or min(4, os.cpu_count() or 1)

    files = collect_inputs(args.inputs, args.recursive, args.sort)
    if not files:
        sys.exit("動画ファイルが見つかりませんでした。パスと拡張子を確認してください。")

    infos, skipped = [], []
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        for f, info in zip(files, pool.map(probe, files)):
            (infos if info else skipped).append(info or f)
    for f in skipped:
        print(f"  スキップ (読み込めません): {os.path.basename(f)}")
    if not infos:
        sys.exit("読み込める動画がありませんでした。")

    if args.size:
        w, h = (int(x) for x in args.size.lower().split("x"))
    else:
        w, h = infos[0]["width"], infos[0]["height"]
    fps = args.fps or round(infos[0]["fps"], 3)
    target = (w, h, fps)

    grid_w = args.grid_width
    grid_h = max(2, int(round(grid_w * (infos[0]["height"] or 9)
                              / (infos[0]["width"] or 16) / 2)) * 2)
    print(f"対象: {len(infos)} ファイル / 出力 {w}x{h} @ {fps}fps / 並列 {jobs} / "
          f"解析グリッド {grid_w}x{grid_h}")
    print("-" * 68)

    def analyze(info):
        return motion_series(info["path"], args.sample_fps, grid_w, grid_h,
                             args.cell_threshold)

    if args.no_trim:
        plan = [(info, [(0.0, info["duration"])]) for info in infos]
        for info in infos:
            print(f"{os.path.basename(info['path'])}: {hms(info['duration'])} (カットなし)")
        total_src = total_keep = sum(i["duration"] for i in infos)
    else:
        plan, total_src, total_keep = [], 0.0, 0.0
        with ThreadPoolExecutor(max_workers=jobs) as pool:
            for info, diffs in zip(infos, pool.map(analyze, infos)):
                name = os.path.basename(info["path"])
                dur = info["duration"]
                total_src += dur

                if args.analyze:
                    pcts = " ".join(f"p{p}={percentile(diffs, p):.2f}"
                                    for p in (1, 5, 10, 25, 50, 75, 90, 95, 99))
                    print(f"{name}: n={len(diffs)} 最大={max(diffs or [0]):.2f} {pcts}")
                    continue

                if args.threshold == "auto":
                    thr, lo, hi = auto_threshold(diffs)
                else:
                    thr = float(args.threshold)
                    lo, hi = percentile(diffs, 10), percentile(diffs, 90)

                segs = build_segments(diffs, args.sample_fps, dur, thr,
                                      args.pad, args.merge_gap, args.min_len)
                kept = sum(e - s for s, e in segs)
                total_keep += kept
                ratio = (kept / dur * 100) if dur else 0
                print(f"{name}: {hms(dur)} → {hms(kept)} ({ratio:.0f}% 残す, "
                      f"{len(segs)}区間, しきい値 {thr:.2f}% / 静止 {lo:.2f}% / 動き {hi:.2f}%)")
                if segs:
                    plan.append((info, segs))
                else:
                    print("    ⚠ 全編が静止と判定されました（このファイルは丸ごと除外）")

    if args.analyze:
        print("\n--analyze のため書き出しは行いません。"
              "\n動きのある区間の値を見て --threshold に指定してください。")
        return

    print("-" * 68)
    print(f"合計: {hms(total_src)} → {hms(total_keep)} ({hms(total_src - total_keep)} カット)")

    if args.dry_run:
        print("\n--dry-run のため書き出しは行いません。")
        return
    if not plan:
        sys.exit("残す区間がありません。--analyze で分布を確認し --threshold を下げてください。")

    encoder = pick_encoder(args.encoder, target)
    print(f"エンコーダ: {encoder}")

    tmp = tempfile.mkdtemp(prefix="mergetrim_")
    try:
        tasks = []
        for info, segs in plan:
            for start, end in segs:
                tasks.append((info, start, end))
        done = [0]

        def work(idx_task):
            idx, (info, start, end) = idx_task
            dst = os.path.join(tmp, f"part_{idx:05d}.mp4")
            ok = encode_segment(info["path"], start, end, dst, target,
                                info["has_audio"], args.crf, args.preset, encoder)
            done[0] += 1
            print(f"\r書き出し中 {done[0]}/{len(tasks)} ...", end="", flush=True)
            return dst if ok else None

        with ThreadPoolExecutor(max_workers=jobs) as pool:
            parts = [p for p in pool.map(work, enumerate(tasks, 1)) if p]
        print()
        if not parts:
            sys.exit("区間の書き出しに失敗しました。")

        listfile = os.path.join(tmp, "concat.txt")
        with open(listfile, "w", encoding="utf-8") as fh:
            for p in parts:
                fh.write("file '%s'\n" % p.replace("'", r"'\''"))

        out = os.path.abspath(os.path.expanduser(args.output))
        os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
        print("結合中 ...")
        r = run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0",
                 "-i", listfile, "-c", "copy", "-movflags", "+faststart", out])
        if r.returncode != 0:
            sys.stderr.write(r.stderr.decode("utf-8", "replace"))
            sys.exit("結合に失敗しました。")
        final = probe(out)
        print(f"\n完成: {out}")
        if final:
            print(f"       {hms(final['duration'])} / {os.path.getsize(out) / 1e6:.1f} MB")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
