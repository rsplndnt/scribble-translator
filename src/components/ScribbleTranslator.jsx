import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";

/* ===================== 翻訳ユーティリティ ===================== */
// CORS対応の無料API（精度より試作用）
const translateWithMyMemory = async (text, targetLang) => {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
      text
    )}&langpair=ja|${targetLang}`;
    const res = await fetch(url);
    const data = await res.json();
    return data?.responseData?.translatedText ?? "";
  } catch {
    return "翻訳エラー";
  }
};

const translateToJapanese = async (text, sourceLang) => {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
      text
    )}&langpair=${sourceLang}|ja`;
    const res = await fetch(url);
    const data = await res.json();
    return data?.responseData?.translatedText ?? "";
  } catch {
    return "翻訳エラー";
  }
};

/* ===================== 手書き修正モーダル ===================== */
const InkModal = ({ open, onCancel, onSave, initialHint = "" }) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [fallbackText, setFallbackText] = useState(initialHint);

  useEffect(() => {
    if (!open) return;
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#6b7280";
  }, [open]);

  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    const x = (e.touches?.[0]?.clientX ?? e.clientX) - r.left;
    const y = (e.touches?.[0]?.clientY ?? e.clientY) - r.top;
    return { x, y };
  };

  const onDown = (e) => {
    e.preventDefault();
    setIsDrawing(true);
    const { x, y } = pos(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const onMove = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const { x, y } = pos(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const onUp = () => setIsDrawing(false);

  const clear = () => {
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
  };

  if (!open) return null;
  return (
    <div style={styles.modalBackdrop}>
      <div style={styles.modalCard}>
        <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 18 }}>
          ✍️ 手書き修正
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
          <canvas
            ref={canvasRef}
            width={820}
            height={270}
            style={styles.inkCanvas}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
            onTouchStart={onDown}
            onTouchMove={onMove}
            onTouchEnd={onUp}
          />
          <div style={{ width: 220, display: "flex", flexDirection: "column", gap: 12 }}>
            <input
              value={fallbackText}
              onChange={(e) => setFallbackText(e.target.value)}
              placeholder="認識文字（任意）"
              style={styles.textInput}
            />
            <button onClick={clear} style={styles.btnGhost}>🧹 クリア</button>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 16 }}>
          <button onClick={onCancel} style={styles.btnGhost}>キャンセル</button>
          <button
            onClick={() => {
              const dataUrl = canvasRef.current.toDataURL("image/png");
              // 手書きデータをimageDataとして渡す
              onSave({ imageData: dataUrl });
            }}
            style={styles.btnPrimary}
          >
            修正
          </button>
        </div>
      </div>
    </div>
  );
};

/* ===================== キーボード編集モーダル ===================== */
const KeyboardModal = ({ open, initial, onCancel, onSave }) => {
  const [val, setVal] = useState(initial || "");
  useEffect(() => setVal(initial || ""), [initial, open]);
  if (!open) return null;
  return (
    <div style={styles.modalBackdrop}>
      <div style={styles.modalCard}>
        <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 18 }}>⌨️ テキスト編集</div>
        <textarea
          value={val}
          onChange={(e) => setVal(e.target.value)}
          rows={5}
          style={{ ...styles.textInput, width: "100%", resize: "vertical" }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 16 }}>
          <button onClick={onCancel} style={styles.btnGhost}>キャンセル</button>
          <button onClick={() => onSave(val)} style={styles.btnPrimary}>保存</button>
        </div>
      </div>
    </div>
  );
};

/* ===================== メイン ===================== */
const ScribbleTranslator = () => {
  /* ------ 状態 ------ */
  const [mode, setMode] = useState("idle"); // 'idle'|'shown'|'selecting'|'editingKeyboard'|'editingInk'
  const [currentText, setCurrentText] = useState(""); // 音声から溜める
  const [visibleText, setVisibleText] = useState(""); // 「しゃべる→表示」後に出す本文
  const [targetLang, setTargetLang] = useState("en"); // 翻訳先
  const [triplet, setTriplet] = useState({ src: "", back: "", trans: "" }); // 上/中/下
  const [bunsetsuGroups, setBunsetsuGroups] = useState([]); // {indices:number[], text:string}
  const [selectedGroups, setSelectedGroups] = useState(new Set()); // 文節インデックス
  const [isListening, setIsListening] = useState(false);
  const [recognition, setRecognition] = useState(null);

  // タイル描画
  const topRef = useRef(null);
  const overlayRef = useRef(null);
  const [tilePositions, setTilePositions] = useState([]); // 1行の各文字座標
  const [drawPath, setDrawPath] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);

  // フローティングボタン座標
  const [floatPos, setFloatPos] = useState(null);

  // 編集モーダル
  const [openKbd, setOpenKbd] = useState(false);
  const [openInk, setOpenInk] = useState(false);

  // 文字index -> 文節index の逆引きを作成（選択ハイライト/タップ判定を高速化）
  const charToGroup = useMemo(() => {
    const map = new Map();
    bunsetsuGroups.forEach((g, gi) => g.indices.forEach((idx) => map.set(idx, gi)));
    return map;
  }, [bunsetsuGroups]);

  /* ------ 文字スタイル（太字+縁取り） ------ */
  const outline = {
    fontWeight: 800,
    WebkitTextStroke: "2px #FFFFFF",
    textShadow:
      "-2px -2px 0 #FFFFFF, 2px -2px 0 #FFFFFF, -2px 2px 0 #FFFFFF, 2px 2px 0 #FFFFFF, 0 3px 12px rgba(0,0,0,.28)",
    color: "#374151",
    letterSpacing: "0.5px",
  };

  /* ------ 音声認識 ------ */
  useEffect(() => {
    if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new SR();
      rec.lang = "ja-JP";
      rec.interimResults = true;
      rec.continuous = true;
      rec.onresult = (e) => {
        let finalTranscript = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript;
          }
        if (finalTranscript) setCurrentText((p) => p + finalTranscript);
      };
      rec.onerror = () => setIsListening(false);
      rec.onend = () => setIsListening(false);
      setRecognition(rec);
    }
  }, []);

  const toggleMic = () => {
    if (!recognition) return alert("ブラウザが音声認識に対応していません");
    if (isListening) {
      recognition.stop();
      setIsListening(false);
    } else {
      setCurrentText(""); // 新規に聞き直す
      recognition.start();
      setIsListening(true);
    }
  };

  /* ------ 文節分割（kuromojiがあれば使用） ------ */
  useEffect(() => {
    const build = async () => {
      if (!visibleText) {
        setBunsetsuGroups([]);
        return;
      }
      if (window.kuromoji) {
        const dicPathCandidates = [
          "./dict/",
          "/dict/",
          "./kuromoji/dict/",
          "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/",
        ];
        let tokenizer = null;
        for (const dicPath of dicPathCandidates) {
          try {
            tokenizer = await new Promise((resolve, reject) => {
              window.kuromoji.builder({ dicPath }).build((err, t) => (err ? reject(err) : resolve(t)));
            });
            break;
          } catch {}
        }
        if (tokenizer) {
          const tokens = tokenizer.tokenize(visibleText);
          const groups = [];
          let cur = [];
          let idxs = [];
          let charIndex = 0;
          tokens.forEach((tk, i) => {
            const len = tk.surface_form.length;
            const inds = Array.from({ length: len }, (_, k) => charIndex + k);
            cur.push(tk.surface_form);
            idxs.push(...inds);
            const shouldSplit =
              tk.pos === "助詞" ||
              tk.pos === "助動詞" ||
              /[、。！？]/.test(tk.surface_form) ||
              i === tokens.length - 1;
            if (shouldSplit) {
              groups.push({ indices: [...idxs], text: cur.join("") });
              cur = [];
              idxs = [];
            }
            charIndex += len;
          });
          setBunsetsuGroups(groups);
          return;
        }
      }
      // フォールバック：1文字ずつ
      setBunsetsuGroups(
        visibleText.split("").map((ch, i) => ({ indices: [i], text: ch }))
      );
    };
    build();
  }, [visibleText]);

  /* ------ 翻訳（表示するたび/編集するたび） ------ */
  useEffect(() => {
    const run = async () => {
      const src =
        selectedGroups.size > 0
          ? [...selectedGroups].sort((a, b) => a - b).map((i) => bunsetsuGroups[i]?.text ?? "").join("")
          : visibleText;
      const text = (src || "").trim();
      if (!text) {
        setTriplet({ src: "", back: "", trans: "" });
        return;
      }
      const trans = await translateWithMyMemory(text, targetLang);
      const back = await translateToJapanese(trans, targetLang);
      setTriplet({ src: text, back, trans });
    };
    run();
  }, [visibleText, selectedGroups, bunsetsuGroups, targetLang]);

  /* ------ 1行タイルのレイアウト ------ */
  const displayText = visibleText;
  useEffect(() => {
    const el = topRef.current;
    const w = el?.offsetWidth || 900;
    const margin = 0;
    const maxW = Math.max(200, w - margin * 2);
    const N = Math.max(1, displayText.length);
    // 文字サイズを自動調整（最小24〜最大48）
    const spacing = 8;
    const charSize = Math.max(
      24,
      Math.min(48, (maxW - (N - 1) * spacing) / N)
    );
    const lineHeight = charSize + 8; // 行間
    const pos = [];
    let currentX = margin;
    let currentY = Math.max(30, Math.round(charSize)); // ベースライン
    let charIndex = 0;
    
    displayText.split("").forEach((ch, i) => {
      if (ch === '\n') {
        // 改行の場合
        currentX = margin;
        currentY += lineHeight;
        charIndex++;
        return;
      }
      
      pos.push({
        char: ch,
        id: `tile-${i}`,
        index: charIndex,
        x: currentX + charSize / 2,
        y: currentY,
        charSize
      });
      
      currentX += charSize + spacing;
      charIndex++;
    });
    setTilePositions(pos);
  }, [displayText]);

  /* ------ なぞりで文節選択 ------ */
  const getMousePos = (e) => {
    const r = overlayRef.current.getBoundingClientRect();
    const x = (e.touches?.[0]?.clientX ?? e.clientX) - r.left;
    const y = (e.touches?.[0]?.clientY ?? e.clientY) - r.top;
    return { x, y };
  };

  // Pointer Events 版（高速移動でも切れにくいように capture する）
  const startDrawPointer = (e) => {
    if (!displayText) return;
    setMode("selecting");
    e.preventDefault();
    e.stopPropagation();
    try { overlayRef.current?.setPointerCapture?.(e.pointerId); } catch {}
    setIsDrawing(true);
    const r = overlayRef.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    setDrawPath([{ x, y }]);
  };
  const moveDrawPointer = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    e.stopPropagation();
    const r = overlayRef.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    setDrawPath((p) => {
      const last = p[p.length - 1];
      // 最小移動量（ノイズ除去）
      if (!last || Math.hypot(x - last.x, y - last.y) > 0.5) return [...p, { x, y }];
      return p;
    });
  };
  const stopDrawPointer = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    e.stopPropagation();
    try { overlayRef.current?.releasePointerCapture?.(e.pointerId); } catch {}
    // 既存の stopDraw を流用
    stopDraw();
  };
  const startDraw = (e) => {
    if (!displayText) return;
    setMode("selecting");
    e.preventDefault();
    setIsDrawing(true);
    setDrawPath([getMousePos(e)]);
  };
  const moveDraw = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    setDrawPath((p) => [...p, getMousePos(e)]);
  };
  const stopDraw = () => {
    if (!isDrawing) return;
    setIsDrawing(false);

    // 触れた文字index（矩形当たり判定 + 余白）
    const touchedIndex = new Set();
    const pad = 10; // 当たり余白

    for (const p of drawPath) {
      for (const pos of tilePositions) {
        const half = pos.charSize / 2;
        const left = pos.x - half - pad;
        const right = pos.x + half + pad;
        const top = pos.y - half - pad;
        const bottom = pos.y + half + pad;
        if (p.x >= left && p.x <= right && p.y >= top && p.y <= bottom) {
          touchedIndex.add(pos.index);
        }
      }
    }

    if (touchedIndex.size > 0) {
      if (bunsetsuGroups.length > 0) {
        // 文節がある場合：文節単位で選択
        const touchedGroups = new Set();
        bunsetsuGroups.forEach((g, gi) => {
          if (g.indices.some((i) => touchedIndex.has(i))) touchedGroups.add(gi);
        });

        if (touchedGroups.size > 0) {
          setSelectedGroups((prev) => {
            const s = new Set(prev);
            // トグル：触れたものをON/OFF
            touchedGroups.forEach((gi) => (s.has(gi) ? s.delete(gi) : s.add(gi)));
            return s;
          });
        }
      } else {
        // 文節がない場合：文字単位で選択（原文表示状態）
        setSelectedGroups((prev) => {
          const s = new Set(prev);
          // 触れた文字のインデックスを文節として扱う
          touchedIndex.forEach((charIndex) => {
            const groupIndex = charIndex; // 文字インデックスをそのまま文節インデックスとして使用
            s.has(groupIndex) ? s.delete(groupIndex) : s.add(groupIndex);
          });
          return s;
        });
      }
    }
    setDrawPath([]);
  };

  /* ------ タップで文節トグル ------ */
  const toggleGroupByIndex = (charIndex) => {
    setMode("selecting");
    const gIdx = bunsetsuGroups.length > 0 ? charToGroup.get(charIndex) : charIndex;
    if (gIdx === undefined) return;
    setSelectedGroups((prev) => {
      const s = new Set(prev);
      s.has(gIdx) ? s.delete(gIdx) : s.add(gIdx);
      return s;
    });
  };

  /* ------ フローティング（削除/キャンセル）位置 ------ */
  useEffect(() => {
    if (!selectedGroups.size) {
      setFloatPos(null);
      return;
    }
    
    let selectedIdx;
    if (bunsetsuGroups.length > 0) {
      // 文節がある場合：文節の文字インデックスを取得
      selectedIdx = new Set(
        [...selectedGroups].flatMap((gi) => bunsetsuGroups[gi]?.indices ?? [])
      );
    } else {
      // 文節がない場合：選択されたインデックスをそのまま使用
      selectedIdx = selectedGroups;
    }
    
    const pts = [...selectedIdx].map((i) => {
      const p = tilePositions[i];
      return p ? { x: p.x, y: p.y } : null;
    }).filter(Boolean);
    if (!pts.length) return;
    const x = Math.max(...pts.map((p) => p.x)) + 10;
    const y = Math.max(...pts.map((p) => p.y)) + 26;
    setFloatPos({ x, y });
  }, [selectedGroups, bunsetsuGroups, tilePositions]);

  /* ------ 削除処理 ------ */
  const handleDelete = () => {
    if (!selectedGroups.size) return;
    const del = new Set();
    [...selectedGroups].forEach((gi) =>
      bunsetsuGroups[gi]?.indices.forEach((i) => del.add(i))
    );
    const next = visibleText
      .split("")
      .filter((_, i) => !del.has(i))
      .join("");
    setCurrentText(next);
    setVisibleText(next);
    setSelectedGroups(new Set());
    setMode("shown");
  };

  /* ------ 手書き文字認識（Google Cloud Vision API） ------ */
  const recognizeHandwriting = async (imageData) => {
    try {
      console.log('手書き認識開始, 画像データ長:', imageData.length);
      
      // 画像データをBase64に変換
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      return new Promise((resolve, reject) => {
        img.onload = async () => {
          console.log('画像読み込み完了, サイズ:', img.width, 'x', img.height);
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          
          // CanvasからBase64データを取得
          const base64Data = canvas.toDataURL('image/png').split(',')[1];
          console.log('Base64データ長:', base64Data.length);
          
          try {
            console.log('Vision API呼び出し中...');
            // Google Cloud Vision APIを直接呼び出し
            const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=AIzaSyAnNa3i7poRqdEtVzhLBgq2nohs4iZESwg`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                requests: [{
                  image: { content: base64Data },
                  features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
                }]
              })
            });
            
            console.log('API応答ステータス:', response.status);
            
            if (!response.ok) {
              const errorText = await response.text();
              console.error('API応答エラー:', errorText);
              throw new Error(`API呼び出しエラー: ${response.status} - ${errorText}`);
            }
            
            const result = await response.json();
            console.log('API応答:', result);
            
            // 手書き文字認識の結果を処理
            if (result.responses && result.responses[0] && result.responses[0].fullTextAnnotation) {
              const recognizedText = result.responses[0].fullTextAnnotation.text;
              console.log('認識されたテキスト:', recognizedText);
              resolve(recognizedText.trim());
            } else {
              console.log('テキスト認識されませんでした');
              resolve('');
            }
          } catch (error) {
            console.error('Vision API エラー:', error);
            reject(error);
          }
        };
        
        img.onerror = () => {
          console.error('画像読み込みエラー');
          reject(new Error('画像の読み込みに失敗しました'));
        };
        img.src = imageData;
      });
    } catch (error) {
      console.error('手書き文字認識エラー:', error);
      throw error;
    }
  };

  /* ------ 編集適用（手書き/キーボード共通） ------ */
  const applyReplace = (text) => {
    const t = (text || "").trim();
    if (!t) return;
    if (selectedGroups.size > 0) {
      // 選択範囲の最小〜最大indexを置換
      let indices;
      if (bunsetsuGroups.length > 0) {
        // 文節がある場合：選択された文節のインデックス
        indices = [...selectedGroups].flatMap((gi) => bunsetsuGroups[gi]?.indices ?? []);
    } else {
        // 文節がない場合：選択された文字のインデックス
        indices = [...selectedGroups];
      }
      
      if (indices.length > 0) {
        const min = Math.min(...indices);
        const max = Math.max(...indices);
        const next =
          visibleText.slice(0, min) + t + visibleText.slice(max + 1);
        setCurrentText(next);
        setVisibleText(next);
        setSelectedGroups(new Set());
      }
    } else {
      setCurrentText(t);
      setVisibleText(t);
    }
    setMode("shown");
  };

  /* ------ UI ------ */
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>🎨 なぞって表示する音声入力翻訳</h1>
        <p style={styles.subtitle}>原文 → 折り返し → 翻訳（文節なぞり選択／編集対応）</p>
      </div>

      <div style={styles.toolbar}>
        <div style={styles.toolbarInfo}>
          {isListening ? (
            <span style={{ color: "#ef4444", fontWeight: 600 }}>🎤 音声入力中…</span>
          ) : (
            <span>📝 取得文字数: {currentText.length}</span>
          )}
        </div>
        <div style={styles.toolbarButtons}>
          <button onClick={toggleMic} style={styles.btnBlue}>
            {isListening ? "⏹ 音声停止" : "🎤 音声入力"}
          </button>
          <button 
            onClick={() => {
              setVisibleText(currentText);
              setSelectedGroups(new Set());
              setMode("shown");
            }}
            style={styles.btnPurple}
          >
            🗣️ しゃべる→表示
          </button>
          <select
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
            style={styles.select}
            aria-label="翻訳先言語"
          >
            <option value="en">英語</option>
            <option value="ko">韓国語</option>
            <option value="zh">中国語</option>
          </select>
          <button onClick={() => setOpenKbd(true)} style={styles.btnGhost}>
            ⌨️ キーボード編集
            </button>
          <button onClick={() => setOpenInk(true)} style={styles.btnGhost}>
            ✍️ 手書き編集
          </button>
          <button
            onClick={() => {
              setCurrentText("");
              setVisibleText("");
              setSelectedGroups(new Set());
              setTriplet({ src: "", back: "", trans: "" });
              setMode("idle");
            }}
            style={styles.btnDanger}
          >
            🔄 リセット
          </button>
        </div>
      </div>

      <div style={styles.main}>
        {/* ===== 三段：原文 → 折り返し → 翻訳 ===== */}
        {visibleText ? (
          <div style={styles.card}>
            {/* 1) 原文：改行対応タイル（太字+縁取り / なぞり＆タップ可） */}
            <div ref={topRef} style={{ position: "relative", minHeight: 76, marginBottom: 10 }}>
              {tilePositions.map((c) => {
                const gIdx = bunsetsuGroups.length > 0 ? charToGroup.get(c.index) : c.index;
                const selected = gIdx !== undefined && selectedGroups.has(gIdx);
                  return (
                  <span
                    key={c.id}
                    onClick={() => toggleGroupByIndex(c.index)}
                      style={{
                      position: "absolute",
                      left: `${c.x}px`,
                      top: `${c.y}px`,
                      transform: "translate(-50%,-50%)",
                      fontSize: c.charSize,
                      fontWeight: 800,
                      WebkitTextStroke: "1.5px #FFFFFF",
                      color: "#ff0000",
                      letterSpacing: "0.5px",
                      cursor: "pointer",
                      backgroundColor: selected ? "rgba(9, 111, 202, 0.2)" : "transparent",
                      borderRadius: selected ? "4px" : "0px",
                      padding: selected ? "2px 4px" : "0px",
                      borderBottom: selected ? "3px solid #096FCA" : "none",
                    }}
                  >
                    {c.char === " " ? "\u00A0" : c.char}
                  </span>
                );
              })}

              {/* なぞりオーバーレイ */}
          <div
            ref={overlayRef}
            style={styles.overlay}
            onMouseDown={startDraw}
            onMouseMove={moveDraw}
            onMouseUp={stopDraw}
            onMouseLeave={stopDraw}
            onTouchStart={startDraw}
            onTouchMove={moveDraw}
            onTouchEnd={stopDraw}
            onPointerDown={startDrawPointer}
            onPointerMove={moveDrawPointer}
            onPointerUp={stopDrawPointer}
          >
            {isDrawing && drawPath.length > 1 && (
              <svg style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                <path
                  d={`M ${drawPath.map((p) => `${p.x},${p.y}`).join(" L ")}`}
                  stroke="#096FCA"
                  strokeWidth={6}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.8}
                />
              </svg>
            )}
          </div>

              {/* 選択時のフローティング操作 */}
              {mode === "selecting" && floatPos && selectedGroups.size > 0 && (
                <div style={{ position: "absolute", left: floatPos.x, top: floatPos.y, display: "flex", gap: 8 }}>
                  <button onClick={handleDelete} style={styles.btnDangerSm}>🗑 削除</button>
                  <button onClick={() => setOpenKbd(true)} style={styles.btnPrimarySm}>⌨️ キーボード修正</button>
                  <button onClick={() => setOpenInk(true)} style={styles.btnPrimarySm}>✍️ 手書き修正</button>
                  <button onClick={() => setSelectedGroups(new Set())} style={styles.btnGhostSm}>
                    ✖ キャンセル
              </button>
            </div>
          )}
        </div>

                        {/* 2) 折り返し（日本語） */}
          <div style={{
              fontSize: 20, 
              marginBottom: 14, 
              opacity: 0.95,
              fontWeight: 800,
              WebkitTextStroke: "1px #FFFFFF",
              color: "#ff0000",
              letterSpacing: "0.5px"
            }}>
              {triplet.back}
          </div>

                        {/* 3) 翻訳（選択言語） */}
                  <div style={{
              fontSize: 42,
              fontWeight: 800,
              WebkitTextStroke: "1.5px #FFFFFF",
              color: "#ff0000",
              letterSpacing: "0.5px"
            }}>{triplet.trans}</div>
                  </div>
        ) : (
          <div style={styles.empty}>
            まず「🎤 音声入力」で話してから「🗣️ しゃべる→表示」を押してください
                </div>
        )}
            </div>
            
              {/* アクセシビリティ：翻訳更新の読み上げ */}
        <div aria-live="polite" aria-atomic="true" style={{position:'absolute', left:-9999, top:'auto'}}>
          {triplet.back} {triplet.trans}
                      </div>

        {/* モーダル達 */}
        <KeyboardModal
        open={openKbd}
        initial={(() => {
          if (selectedGroups.size > 0) {
            if (bunsetsuGroups.length > 0) {
              // 文節がある場合：選択された文節のテキスト
              return [...selectedGroups].sort((a, b) => a - b)
                .map(i => bunsetsuGroups[i]?.text ?? '')
                .join('');
            } else {
              // 文節がない場合：選択された文字のテキスト
              return [...selectedGroups].sort((a, b) => a - b)
                .map(i => displayText[i] ?? '')
                .join('');
            }
          }
          return visibleText;
        })()}
        onCancel={() => setOpenKbd(false)}
        onSave={(val) => {
          setOpenKbd(false);
          applyReplace(val);
        }}
      />
      <InkModal
        open={openInk}
        onCancel={() => setOpenInk(false)}
        onSave={async ({ imageData }) => {
          console.log('手書きデータ受信:', imageData ? 'あり' : 'なし');
          if (imageData) {
            try {
              console.log('手書き文字認識開始...');
              // 手書き文字認識を実行
              const recognizedText = await recognizeHandwriting(imageData);
              console.log('認識結果:', recognizedText);
              if (recognizedText) {
                applyReplace(recognizedText);
              } else {
                alert('手書き文字を認識できませんでした。もう一度お試しください。');
              }
            } catch (error) {
              console.error('手書き文字認識エラー:', error);
              alert('手書き文字認識中にエラーが発生しました。');
            }
          } else {
            console.error('手書きデータが受信されませんでした');
            alert('手書きデータの取得に失敗しました。');
          }
          setOpenInk(false);
        }}
        initialHint={(() => {
          if (selectedGroups.size > 0) {
            if (bunsetsuGroups.length > 0) {
              // 文節がある場合：選択された文節のテキスト
              return [...selectedGroups].sort((a, b) => a - b)
                .map(i => bunsetsuGroups[i]?.text ?? '')
                .join('');
            } else {
              // 文節がない場合：選択された文字のテキスト
              return [...selectedGroups].sort((a, b) => a - b)
                .map(i => displayText[i] ?? '')
                .join('');
            }
          }
          return visibleText;
        })()}
      />
    </div>
  );
};

/* ===================== スタイル ===================== */
const styles = {
  container: {
    width: "100%",
    minHeight: "100vh",
    background: "#f8fafc",
    fontFamily: '"Noto Sans JP", system-ui, -apple-system, sans-serif',
    color: "#374151",
  },
  header: {
    background: "linear-gradient(135deg, #096FCA 0%, #76B7ED 100%)",
    color: "#fff",
    padding: "20px 28px",
    boxShadow: "0 6px 22px rgba(9,111,202,.28)",
  },
  title: { margin: 0, fontSize: 28, fontWeight: 800 },
  subtitle: { margin: "6px 0 0", opacity: 0.95 },
  toolbar: {
    background: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "14px 28px",
    borderBottom: "1px solid #e5e7eb",
  },
  toolbarInfo: { fontSize: 14 },
  toolbarButtons: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" },
  btnBlue: {
    padding: "8px 14px",
    background: "#3b82f6",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontWeight: 700,
    boxShadow: "0 2px 10px rgba(59,130,246,.25)",
    cursor: "pointer",
  },
  btnPurple: {
    padding: "8px 14px",
    background: "#8B5CF6",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontWeight: 700,
    boxShadow: "0 2px 10px rgba(139,92,246,.25)",
    cursor: "pointer",
  },
  btnGhost: {
    padding: "8px 14px",
    background: "#f3f4f6",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    fontWeight: 700,
    cursor: "pointer",
  },
  btnDanger: {
    padding: "8px 14px",
    background: "#FF7669",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 2px 10px rgba(255,118,105,.25)",
  },
  select: { padding: "8px 12px", border: "1px solid #e5e7eb", borderRadius: 8 },
  main: { maxWidth: 1100, margin: "24px auto", padding: "0 28px" },
  card: {
    background: "#DDDDDD",
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    boxShadow: "0 10px 26px rgba(0,0,0,.06)",
    padding: 24,
  },
  empty: {
    color: "#6b7280",
    background: "#DDDDDD",
    border: "1px dashed #e5e7eb",
    borderRadius: 12,
    padding: 28,
    textAlign: "center",
  },
  overlay: {
    position: "absolute",
    inset: 0,
    cursor: "crosshair",
    touchAction: "none",
  },
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,.55)",
    display: "grid",
    placeItems: "center",
    zIndex: 1000,
  },
  modalCard: {
    width: "min(980px, 94vw)",
    background: "#DDDDDD",
    borderRadius: 16,
    boxShadow: "0 22px 60px rgba(0,0,0,.30)",
    padding: 20,
  },
  inkCanvas: {
    background: "#DDDDDD",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    touchAction: "none",
    boxShadow: "inset 0 1px 4px rgba(0,0,0,.06)",
  },
  textInput: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    fontSize: 16,
  },
  btnPrimary: {
    padding: "12px 20px",
    background: "#096FCA",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    fontWeight: 800,
    cursor: "pointer",
  },
  btnGhostSm: {
    padding: "6px 10px",
    border: "1px solid #e5e7eb",
    background: "#fff",
    borderRadius: 8,
    fontWeight: 700,
    cursor: "pointer",
  },
  btnDangerSm: {
    padding: "6px 10px",
    border: "none",
    background: "#ef4444",
    color: "#fff",
    borderRadius: 8,
    fontWeight: 700,
    cursor: "pointer",
  },
  btnPrimarySm: {
    padding: "6px 10px",
    border: "none",
    background: "#096FCA",
    color: "#fff",
    borderRadius: 8,
    fontWeight: 700,
    cursor: "pointer",
  },
};

export default ScribbleTranslator;
