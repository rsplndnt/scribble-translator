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

VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".mts", ".m2ts", ".avi", ".mkv", ".mpg", ".mpeg", ".wmv", ".ts"}

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

def motion_series(path, sample_fps, grid_w, grid_h):
    """縮小したグレースケール画像のフレーム間差分を返す (1サンプル=1値)。"""
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
                    diffs.append(float(np.abs(a - b).mean()))
                else:
                    total = 0
                    for x, y in zip(prev, buf):
                        total += x - y if x > y else y - x
                    diffs.append(total / size)
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

    静止側の値がまとまった塊になっていて、動き側とはっきり離れている場合だけ
    その中間をしきい値にする。差がはっきりしない場合は、絶対値で
    「全編静止」か「全編動き」かを判定する（迷ったら残す方に倒す）。
    """
    if not diffs:
        return 1.2, 0.0, 0.0
    lo = percentile(diffs, 10)   # 静止側の代表値
    mid = percentile(diffs, 50)
    hi = percentile(diffs, 90)   # 動き側の代表値
    still_floor = 1.2            # 縮小画像でこれ未満の変化は実質静止

    if hi >= max(lo * 2.0, lo + 1.0):
        # 静止と動きがはっきり分かれている → その間を取る
        thr = lo + 0.25 * (hi - lo)
        return max(thr, still_floor, lo * 1.3, 0.4), lo, hi

    # 分布が一様 = 全編ほぼ同じ状態
    if mid < still_floor:
        return still_floor, lo, hi          # 全編静止 → 何も残さない
    return max(lo * 0.9, 0.4), lo, hi       # 全編動き → 全部残す


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

def encode_segment(src, start, end, dst, target, has_audio, crf, preset):
    w, h, fps = target
    vf = (f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
          f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps},format=yuv420p")
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.3f}", "-i", src]
    if not has_audio:
        cmd += ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"]
    cmd += ["-t", f"{max(end - start, 0.05):.3f}",
            "-map", "0:v:0", "-map", ("0:a:0" if has_audio else "1:a:0"),
            "-vf", vf, "-c:v", "libx264", "-preset", preset, "-crf", str(crf),
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
            "-video_track_timescale", "90000", "-shortest", dst]
    r = run(cmd)
    if r.returncode != 0:
        sys.stderr.write(r.stderr.decode("utf-8", "replace"))
    return r.returncode == 0


def hms(sec):
    sec = max(0.0, sec)
    return f"{int(sec // 3600):d}:{int(sec // 60) % 60:02d}:{sec % 60:04.1f}"


def main():
    ap = argparse.ArgumentParser(
        description="細切れ動画を結合し、動きのない区間をカットする")
    ap.add_argument("inputs", nargs="+", help="動画のあるフォルダ、または動画ファイル")
    ap.add_argument("-o", "--output", default="merged.mp4", help="出力ファイル (既定: merged.mp4)")
    ap.add_argument("-r", "--recursive", action="store_true", help="サブフォルダも探す")
    ap.add_argument("--sort", choices=["name", "time"], default="name", help="並び順 (既定: name)")
    ap.add_argument("--threshold", default="auto",
                    help="動き判定のしきい値。auto または数値 (大きいほど多くカット)")
    ap.add_argument("--pad", type=float, default=0.7, help="動きの前後に残す秒数 (既定: 0.7)")
    ap.add_argument("--merge-gap", type=float, default=1.5,
                    help="この秒数以下の静止は繋げて残す (既定: 1.5)")
    ap.add_argument("--min-len", type=float, default=0.5,
                    help="これより短い区間は捨てる (既定: 0.5)")
    ap.add_argument("--sample-fps", type=float, default=4.0, help="解析のサンプリングfps (既定: 4)")
    ap.add_argument("--no-trim", action="store_true", help="カットせず結合だけする")
    ap.add_argument("--dry-run", action="store_true", help="解析結果だけ表示して書き出さない")
    ap.add_argument("--crf", type=int, default=20, help="画質 (小さいほど高画質・既定: 20)")
    ap.add_argument("--preset", default="veryfast", help="x264 preset (既定: veryfast)")
    ap.add_argument("--size", help="出力解像度 例: 1920x1080 (既定: 最初の動画に合わせる)")
    ap.add_argument("--fps", type=float, help="出力fps (既定: 最初の動画に合わせる)")
    args = ap.parse_args()

    need("ffmpeg")
    need("ffprobe")

    files = collect_inputs(args.inputs, args.recursive, args.sort)
    if not files:
        sys.exit("動画ファイルが見つかりませんでした。パスと拡張子を確認してください。")

    infos = []
    for f in files:
        info = probe(f)
        if info is None:
            print(f"  スキップ (読み込めません): {os.path.basename(f)}")
            continue
        infos.append(info)
    if not infos:
        sys.exit("読み込める動画がありませんでした。")

    if args.size:
        w, h = (int(x) for x in args.size.lower().split("x"))
    else:
        w, h = infos[0]["width"], infos[0]["height"]
    fps = args.fps or round(infos[0]["fps"], 3)
    target = (w, h, fps)

    print(f"対象: {len(infos)} ファイル / 出力 {w}x{h} @ {fps}fps")
    print("-" * 62)

    plan, total_src, total_keep = [], 0.0, 0.0
    grid_w = 64
    grid_h = max(2, int(round(64 * (infos[0]["height"] or 9) / (infos[0]["width"] or 16) / 2)) * 2)

    for info in infos:
        name = os.path.basename(info["path"])
        dur = info["duration"]
        total_src += dur
        if args.no_trim:
            plan.append((info, [(0.0, dur)]))
            total_keep += dur
            print(f"{name}: {hms(dur)} (カットなし)")
            continue

        diffs = motion_series(info["path"], args.sample_fps, grid_w, grid_h)
        if args.threshold == "auto":
            thr, noise, hi = auto_threshold(diffs)
        else:
            thr, noise, hi = float(args.threshold), percentile(diffs, 10), percentile(diffs, 90)

        segs = build_segments(diffs, args.sample_fps, dur, thr,
                              args.pad, args.merge_gap, args.min_len)
        kept = sum(e - s for s, e in segs)
        total_keep += kept
        ratio = (kept / dur * 100) if dur else 0
        print(f"{name}: {hms(dur)} → {hms(kept)} ({ratio:.0f}% 残す, "
              f"{len(segs)}区間, しきい値 {thr:.2f} / 静止 {noise:.2f} / 動き {hi:.2f})")
        if segs:
            plan.append((info, segs))
        else:
            print("    ⚠ 全編が静止と判定されました（このファイルは丸ごと除外）")

    print("-" * 62)
    print(f"合計: {hms(total_src)} → {hms(total_keep)} "
          f"({hms(total_src - total_keep)} カット)")

    if args.dry_run:
        print("\n--dry-run のため書き出しは行いません。")
        return
    if not plan:
        sys.exit("残す区間がありません。--threshold を小さくして再実行してください。")

    tmp = tempfile.mkdtemp(prefix="mergetrim_")
    try:
        parts, idx = [], 0
        total_parts = sum(len(s) for _, s in plan)
        for info, segs in plan:
            for start, end in segs:
                idx += 1
                dst = os.path.join(tmp, f"part_{idx:05d}.mp4")
                print(f"\r書き出し中 {idx}/{total_parts} ...", end="", flush=True)
                if encode_segment(info["path"], start, end, dst, target,
                                  info["has_audio"], args.crf, args.preset):
                    parts.append(dst)
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
            print(f"       {hms(final['duration'])} / "
                  f"{os.path.getsize(out) / 1e6:.1f} MB")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
