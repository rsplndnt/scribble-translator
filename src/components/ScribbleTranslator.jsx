import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";

/* ===================== 翻訳ユーティリティ ===================== */
// テキスト省略処理
const truncateText = (text, maxLength = 50) => {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
};

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
  const [isBunsetsuMode, setIsBunsetsuMode] = useState(false); // 文節認識モード（デフォルトOFF）
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

  // インライン編集
  const [inlineEditMode, setInlineEditMode] = useState(null); // 'keyboard' | 'ink' | null
  const [inlineEditText, setInlineEditText] = useState('');
  const [inlineEditPosition, setInlineEditPosition] = useState(null);
  
  // 日本語入力の変換確定状態
  const [isComposing, setIsComposing] = useState(false); // IME変換中かどうか
  const [enterPressCount, setEnterPressCount] = useState(0); // エンターキー押下回数
  
  // 手書き用
  const inkCanvasRef = useRef(null);
  const [isInkDrawing, setIsInkDrawing] = useState(false);

  // 文字index -> 文節index の逆引きを作成（選択ハイライト/タップ判定を高速化）
  const charToGroup = useMemo(() => {
    const map = new Map();
    bunsetsuGroups.forEach((g, gi) => g.indices.forEach((idx) => map.set(idx, gi)));
    return map;
  }, [bunsetsuGroups]);

  /* ------ 文字スタイル（太字+縁取り） ------ */
  const outline = {
    fontWeight: 800,
    // WebkitTextStrokeを削除（SVGで代替）
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

  // アニメーション用のスタイルシートを追加
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = keyframes;
    document.head.appendChild(style);
    
    // Material Iconsのスタイルを追加（必要に応じて）
    const materialStyle = document.createElement('style');
    materialStyle.textContent = `
      /* 絵文字用のスタイル */
      .emoji-icon {
        font-size: 20px;
        margin-right: 4px;
        vertical-align: middle;
      }
    `;
    document.head.appendChild(materialStyle);
    
    return () => {
      document.head.removeChild(style);
      document.head.removeChild(materialStyle);
    };
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
    const margin = 20;
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
    
    const r = overlayRef.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    
    // 選択状態の時のみ文字クリックを許可
    if (selectedGroups.size > 0) {
      // クリック位置が文字の上にある場合は、その文字を選択/解除
      const clickedChar = tilePositions.find(c => {
        const distance = Math.hypot(x - c.x, y - c.y);
        return distance <= c.charSize / 2 + 10; // 文字の半径 + 余裕
      });
      
      if (clickedChar) {
        // 文字クリック：選択/解除処理
        console.log('🔥 文字クリック検出 (選択状態):', clickedChar.index);
        toggleGroupByIndex(clickedChar.index);
        return; // 描画処理はしない
      }
    }
    
    // 常に描画開始（初期状態でも選択状態でも）
    console.log('🔥 ぐしゃぐしゃ描画開始');
    try { overlayRef.current?.setPointerCapture?.(e.pointerId); } catch {}
    setIsDrawing(true);
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
      // 移動量の閾値を下げて、線が切れにくくする
      if (!last || Math.hypot(x - last.x, y - last.y) > 0.1) return [...p, { x, y }];
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

  const stopDraw = () => {
    if (!isDrawing) return;
    setIsDrawing(false);

    // 線の折り返しをチェック - 直線的すぎる場合は選択しない
    const hasChanges = hasSignificantDirectionChanges(drawPath);
    console.log('線の折り返し検出:', hasChanges, 'パス長:', drawPath.length);
    console.log('描画パス:', drawPath);
    console.log('パスの詳細分析:');
    console.log('- 始点:', drawPath[0]);
    console.log('- 終点:', drawPath[drawPath.length - 1]);
    if (drawPath.length > 2) {
      const startPoint = drawPath[0];
      const endPoint = drawPath[drawPath.length - 1];
      const totalDistance = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);
      console.log('- 始点-終点距離:', totalDistance.toFixed(2));
      
      // 平均偏差を計算して表示
      let totalDeviation = 0;
      for (let i = 1; i < drawPath.length - 1; i++) {
        const point = drawPath[i];
        const t = ((point.x - startPoint.x) * (endPoint.x - startPoint.x) + 
                   (point.y - startPoint.y) * (endPoint.y - startPoint.y)) / (totalDistance * totalDistance);
        const projectionX = startPoint.x + t * (endPoint.x - startPoint.x);
        const projectionY = startPoint.y + t * (endPoint.y - startPoint.y);
        const deviation = Math.hypot(point.x - projectionX, point.y - projectionY);
        totalDeviation += deviation;
      }
      const avgDeviation = totalDeviation / (drawPath.length - 2);
      console.log('- 平均偏差:', avgDeviation.toFixed(2));
    }
    
    // デバッグ用：一時的に折り返し検出を無効化
    const debugMode = false; // デバッグモード（falseで正常な判定を有効化）
    
    if (!debugMode && !hasChanges) {
      console.log('直線的すぎる線のため、選択をキャンセル');
      setDrawPath([]);
      return;
    }

    // ぐしゃぐしゃ線の軌跡に基づく文字選択
    const touchedIndex = new Set();
    const pad = 8; // 当たり余白（少し小さく）

    // 描画パスを細かく分割して、より自然な選択を実現
    const interpolatedPath = interpolatePath(drawPath);
    console.log('補間後のパス:', interpolatedPath.length, '点');
    
    for (const p of interpolatedPath) {
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
    
    console.log('触れた文字インデックス:', touchedIndex.size, '個');

    if (touchedIndex.size > 0) {
      if (isBunsetsuMode && bunsetsuGroups.length > 0) {
        // 文節モード：文節単位で選択
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
        // 文字モード：文字単位で選択（トグルではなく追加のみ）
        setSelectedGroups((prev) => {
          const s = new Set(prev);
          // 触れた文字を全て選択状態にする（既に選択済みでもそのまま）
          touchedIndex.forEach((charIndex) => {
            s.add(charIndex);
          });
          return s;
        });
      }
    }
    setDrawPath([]);
  };

  /* ------ 線の折り返し検出 ------ */
  const hasSignificantDirectionChanges = (path) => {
    console.log('=== 曲率ベース判定開始 ===');
    console.log('パス長:', path.length);
    
    if (path.length < 3) {
      console.log('パスが短すぎる（3点未満）');
      return false;
    }
    
    // 始点と終点
    const startPoint = path[0];
    const endPoint = path[path.length - 1];
    
    // 始点終点間の直線距離
    const straightDistance = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);
    
    console.log('始点:', startPoint);
    console.log('終点:', endPoint);
    console.log('直線距離:', straightDistance.toFixed(2));
    
    // 直線距離が短すぎる場合は除外
    if (straightDistance < 20) {
      console.log('直線距離が短すぎる（20px未満）');
      return false;
    }
    
    // ストローク長を計算
    let strokeLength = 0;
    for (let i = 1; i < path.length; i++) {
      const prev = path[i - 1];
      const current = path[i];
      const segmentLength = Math.hypot(current.x - prev.x, current.y - prev.y);
      strokeLength += segmentLength;
    }
    
    console.log('ストローク長:', strokeLength.toFixed(2));
    
    // 曲率比を計算（ストローク長 ÷ 直線距離）
    const curvatureRatio = strokeLength / straightDistance;
    
    console.log('曲率比:', curvatureRatio.toFixed(3));
    
    // 曲率比が2.0以上の場合をぐしゃぐしゃ線として判定
    const scribbleThreshold = 2.0;
    const isScribble = curvatureRatio >= scribbleThreshold;
    
    console.log(`判定結果: ${isScribble} (${curvatureRatio.toFixed(3)} >= ${scribbleThreshold})`);
    console.log('=== 曲率ベース判定終了 ===');
    
    return isScribble;
  };


  /* ------ パス補間（ぐしゃぐしゃ線を滑らかに） ------ */
  const interpolatePath = (path) => {
    if (path.length < 2) return path;
    
    const interpolated = [];
    const step = 1; // 補間の細かさを上げて、より滑らかに
    
    for (let i = 0; i < path.length - 1; i++) {
      const current = path[i];
      const next = path[i + 1];
      
      // 現在の点を追加
      interpolated.push(current);
      
      // 2点間を補間
      const distance = Math.hypot(next.x - current.x, next.y - current.y);
      const steps = Math.ceil(distance / step);
      
      for (let j = 1; j < steps; j++) {
        const ratio = j / steps;
        interpolated.push({
          x: current.x + (next.x - current.x) * ratio,
          y: current.y + (next.y - current.y) * ratio
        });
      }
    }
    
    // 最後の点を追加
    interpolated.push(path[path.length - 1]);
    
    return interpolated;
  };

  /* ------ タップで文節/文字トグル ------ */
  const toggleGroupByIndex = (charIndex) => {
    console.log('🔥 toggleGroupByIndex called:', charIndex, 'isBunsetsuMode:', isBunsetsuMode, 'bunsetsuGroups:', bunsetsuGroups.length);
    setMode("selecting");
    
    // 文節モードの場合は文節単位、そうでない場合は文字単位で選択
    if (isBunsetsuMode && bunsetsuGroups.length > 0) {
      // 文節モード：文節全体を選択/解除
      const gIdx = charToGroup.get(charIndex);
      if (gIdx === undefined) return;
      setSelectedGroups((prev) => {
        const s = new Set(prev);
        s.has(gIdx) ? s.delete(gIdx) : s.add(gIdx);
        return s;
      });
    } else {
      // 文字モード：1文字ずつ選択/解除
      console.log('🔥 文字モード - charIndex:', charIndex, 'current selectedGroups:', selectedGroups);
      setSelectedGroups((prev) => {
        const s = new Set(prev);
        const wasSelected = s.has(charIndex);
        if (wasSelected) {
          s.delete(charIndex);
          console.log('🔥 文字を選択解除:', charIndex);
        } else {
          s.add(charIndex);
          console.log('🔥 文字を選択:', charIndex);
        }
        console.log('🔥 新しい selectedGroups:', s);
        return s;
      });
    }
  };

  /* ------ 手書きキャンバス初期化 ------ */
  useEffect(() => {
    if (inlineEditMode === 'ink' && inkCanvasRef.current) {
      const canvas = inkCanvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#096FCA';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
  }, [inlineEditMode]);

  /* ------ テキストエリアの高さ自動調整 ------ */
  const adjustTextareaHeight = (textarea) => {
    if (!textarea) return;
    
    // 高さをリセットして実際の内容の高さを取得
    textarea.style.height = 'auto';
    
    // スクロール高さを取得して適切な高さを設定
    const scrollHeight = textarea.scrollHeight;
    const minHeight = window.innerWidth <= 768 ? 120 : 120;
    const maxHeight = window.innerWidth <= 768 ? 200 : 300;
    
    const newHeight = Math.max(minHeight, Math.min(scrollHeight, maxHeight));
    textarea.style.height = `${newHeight}px`;
    
    // スクロールが必要な場合はスクロールバーを表示
    if (scrollHeight > maxHeight) {
      textarea.style.overflowY = 'auto';
    } else {
      textarea.style.overflowY = 'hidden';
    }
  };

  /* ------ インライン編集開始 ------ */
  const startInlineEdit = (mode) => {
    if (!selectedGroups.size) return;
    
    // 選択された文字のテキストを取得
    let text = '';
    if (bunsetsuGroups.length > 0) {
      text = [...selectedGroups].sort((a, b) => a - b)
        .map(i => bunsetsuGroups[i]?.text ?? '')
        .join('');
    } else {
      text = [...selectedGroups].sort((a, b) => a - b)
        .map(i => displayText[i] ?? '')
        .join('');
    }
    
    setInlineEditText(text);
    setInlineEditMode(mode);
    setInlineEditPosition(floatPos);
    
    // 日本語入力状態をリセット
    setIsComposing(false);
    setEnterPressCount(0);
  };

  /* ------ インライン編集完了 ------ */
  const finishInlineEdit = () => {
    if (inlineEditText.trim()) {
      // 最初の入力時（visibleTextがない場合）は直接設定
      if (!visibleText) {
        setCurrentText(inlineEditText.trim());
        setVisibleText(inlineEditText.trim());
        setMode("shown");
    } else {
        // 既存のテキストがある場合は置換
        applyReplace(inlineEditText);
      }
    }
    setInlineEditMode(null);
    setInlineEditText('');
    setInlineEditPosition(null);
  };

  /* ------ インライン編集キャンセル ------ */
  const cancelInlineEdit = () => {
    setInlineEditMode(null);
    setInlineEditText('');
    setInlineEditPosition(null);
    setIsInkDrawing(false);
  };

  /* ------ 手書き開始 ------ */
  const startInkDrawing = (e) => {
    e.preventDefault();
    setIsInkDrawing(true);
    const canvas = inkCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = (e.touches?.[0]?.clientX ?? e.clientX) - rect.left;
    const y = (e.touches?.[0]?.clientY ?? e.clientY) - rect.top;
    
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  /* ------ 手書き描画 ------ */
  const drawInk = (e) => {
    if (!isInkDrawing) return;
    e.preventDefault();
    const canvas = inkCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = (e.touches?.[0]?.clientX ?? e.clientX) - rect.left;
    const y = (e.touches?.[0]?.clientY ?? e.clientY) - rect.top;
    
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  /* ------ 手書き終了 ------ */
  const stopInkDrawing = () => {
    setIsInkDrawing(false);
  };

  /* ------ 手書きクリア ------ */
  const clearInk = () => {
    const canvas = inkCanvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  /* ------ 手書き認識実行 ------ */
  const recognizeInk = async () => {
    try {
      const canvas = inkCanvasRef.current;
      const imageData = canvas.toDataURL('image/png');
      const recognizedText = await recognizeHandwriting(imageData);
      
      if (recognizedText) {
        setInlineEditText(recognizedText);
        // 手書きモードからキーボードモードに切り替え
        setInlineEditMode('keyboard');
      } else {
        alert('手書き文字を認識できませんでした。もう一度お試しください。');
      }
    } catch (error) {
      console.error('手書き文字認識エラー:', error);
      alert('手書き文字認識中にエラーが発生しました。');
    }
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
    const y = Math.max(...pts.map((p) => p.y)) + 35; // ボタンの当たり判定に合わせて調整
    setFloatPos({ x, y });
  }, [selectedGroups, bunsetsuGroups, tilePositions]);

  /* ------ 削除処理 ------ */
  const handleDelete = () => {
    if (!selectedGroups.size) return;
    
    console.log('削除処理開始 - 選択されたグループ:', selectedGroups);
    console.log('文節グループ数:', bunsetsuGroups.length);
    console.log('現在のテキスト:', visibleText);
    
    let del = new Set();
    
    if (bunsetsuGroups.length > 0) {
      // 文節がある場合：文節の文字インデックスを取得
      [...selectedGroups].forEach((gi) => {
        const group = bunsetsuGroups[gi];
        console.log(`文節グループ ${gi}:`, group);
        if (group?.indices) {
          group.indices.forEach((i) => del.add(i));
        }
      });
    } else {
      // 文節がない場合：選択されたインデックスをそのまま使用
      del = new Set(selectedGroups);
    }
    
    console.log('削除対象インデックス:', del);
    
    const next = visibleText
      .split("")
      .filter((_, i) => !del.has(i))
      .join("");
    
    console.log('削除後のテキスト:', next);
    
    setCurrentText(next);
    setVisibleText(next);
    setSelectedGroups(new Set());
    setMode("shown");
    
    console.log('削除処理完了');
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
        <h1 style={styles.title}>👆しゃべり描き for the future</h1>
      </div>

      <div style={styles.toolbar}>
        {/* メイン操作ボタン群 */}
        <div style={styles.toolbarMain}>
          <button 
            onClick={toggleMic} 
            style={{
              ...styles.btnBlue,
              animation: isListening ? 'float 3s ease-in-out infinite, glow 2s ease-in-out infinite' : 'none',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {isListening ? "⏹ 停止" : "🎤 音声入力"}
            
            {/* ほわほわする波紋エフェクト */}
            {isListening && (
              <>
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  width: '4px',
                  height: '4px',
                  backgroundColor: 'rgba(255, 255, 255, 0.6)',
                  borderRadius: '50%',
                  transform: 'translate(-50%, -50%)',
                  animation: 'ripple 2s ease-out infinite',
                }} />
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  width: '3px',
                  height: '3px',
                  backgroundColor: 'rgba(255, 255, 255, 0.4)',
                  borderRadius: '50%',
                  transform: 'translate(-50%, -50%)',
                  animation: 'ripple 2s ease-out infinite 0.5s',
                }} />
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  width: '2px',
                  height: '2px',
                  backgroundColor: 'rgba(255, 255, 255, 0.3)',
                  borderRadius: '50%',
                  transform: 'translate(-50%, -50%)',
                  animation: 'ripple 2s ease-out infinite 1s',
                }} />
              </>
            )}
          </button>
            <button 
            onClick={() => {
              setVisibleText(currentText);
              setSelectedGroups(new Set());
              setMode("shown");
            }}
            style={styles.btnPurple}
          >
            🗣️ 表示
            </button>
          <button
            onClick={() => {
              setVisibleText("");
              setSelectedGroups(new Set());
              setMode("idle");
            }}
            style={styles.btnGhost}
          >
            🔄 リセット
          </button>
      </div>

        {/* 入力方法選択ボタン群 */}
        <div style={styles.toolbarInput}>
          <button 
            onClick={() => {
              console.log('キーボード入力ボタンがクリックされました');
              setInlineEditMode('keyboard');
              setInlineEditText('');
              // 画面中央付近に配置（テキストボックスサイズを考慮）
              const centerX = window.innerWidth / 2 - 225; // 450px / 2
              const centerY = window.innerHeight / 2 - 100;
              console.log('編集ウィンドウ位置:', { x: centerX, y: centerY });
              setInlineEditPosition({ x: centerX, y: centerY });
              
              // 日本語入力状態をリセット
              setIsComposing(false);
              setEnterPressCount(0);
            }} 
            style={styles.btnGhost}
          >
            ⌨️ キーボード
          </button>
          <button 
            onClick={() => {
              console.log('手書き入力ボタンがクリックされました');
              setInlineEditMode('ink');
              setInlineEditText('');
              // 画面中央付近に配置（手書きキャンバスサイズを考慮）
              const centerX = window.innerWidth / 2 - 150; // 300px / 2
              const centerY = window.innerHeight / 2 - 100;
              console.log('編集ウィンドウ位置:', { x: centerX, y: centerY });
              setInlineEditPosition({ x: centerX, y: centerY });
              
              // 日本語入力状態をリセット
              setIsComposing(false);
              setEnterPressCount(0);
            }} 
            style={styles.btnGhost}
          >
            ✍️ 手書き
          </button>
          
          {/* 文節認識のラジオボタン */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '4px',
            backgroundColor: '#f3f4f6',
            borderRadius: '8px',
            border: '1px solid #d1d5db',
          }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              backgroundColor: isBunsetsuMode ? '#10b981' : 'transparent',
              color: isBunsetsuMode ? '#fff' : '#374151',
              transition: 'all 0.2s ease',
            }}>
              <input
                type="radio"
                name="bunsetsuMode"
                checked={isBunsetsuMode}
                onChange={() => {
                  setIsBunsetsuMode(true);
                  setSelectedGroups(new Set());
                }}
                style={{ display: 'none' }}
              />
              🤖 文節認識ON
            </label>
            
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              backgroundColor: !isBunsetsuMode ? '#6b7280' : 'transparent',
              color: !isBunsetsuMode ? '#fff' : '#374151',
              transition: 'all 0.2s ease',
            }}>
              <input
                type="radio"
                name="bunsetsuMode"
                checked={!isBunsetsuMode}
                onChange={() => {
                  setIsBunsetsuMode(false);
                  setSelectedGroups(new Set());
                }}
                style={{ display: 'none' }}
              />
              🔤 文節認識OFF
            </label>
                    </div>
          </div>

        {/* 言語選択と情報表示 */}
        <div style={styles.toolbarInfo}>
          <select
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
            style={styles.select}
            aria-label="翻訳先言語"
          >
            <option value="en">🇺🇸 英語</option>
            <option value="ko">🇰🇷 韓国語</option>
            <option value="zh">🇨🇳 中国語</option>
          </select>
          
          {isListening ? (
            <span style={styles.listeningIndicator}>🎤 音声入力中…</span>
          ) : (
                          <span style={styles.textCount}>📝 {currentText.length}文字</span>
          )}
        </div>
          </div>

      {/* インライン編集ウィンドウ（常時表示） */}
      {inlineEditMode && inlineEditPosition && (
            <div style={{
          position: "fixed", 
          left: window.innerWidth <= 768 ? "5vw" : inlineEditPosition.x, 
          top: window.innerWidth <= 768 ? "20vh" : inlineEditPosition.y - 60,
          right: window.innerWidth <= 768 ? "5vw" : "auto",
          background: "#fff",
          border: "2px solid #096FCA",
          borderRadius: "8px",
          padding: window.innerWidth <= 768 ? "16px" : "16px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          zIndex: 1000,
          minWidth: window.innerWidth <= 768 ? "90vw" : "450px",
          maxWidth: window.innerWidth <= 768 ? "90vw" : "600px",
          maxHeight: window.innerWidth <= 768 ? "80vh" : "70vh",
          overflow: "auto",
        }}>
          {inlineEditMode === 'keyboard' ? (
            <div>
              <textarea
                value={inlineEditText}
                onChange={(e) => {
                  setInlineEditText(e.target.value);
                  // テキストエリアの高さを自動調整
                  adjustTextareaHeight(e.target);
                }}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault(); // 改行を防ぐ
                    if (isComposing) {
                      // IME変換中は変換確定
                      setEnterPressCount(prev => prev + 1);
                      console.log('変換確定 - エンター回数:', enterPressCount + 1);
                    } else {
                      // IME変換完了後は確定
                      if (enterPressCount > 0) {
                        console.log('確定処理実行');
                        finishInlineEdit();
                        setEnterPressCount(0);
                      } else {
                        console.log('変換確定待ち');
                        setEnterPressCount(1);
                      }
                    }
                  }
                  if (e.key === 'Escape') {
                    cancelInlineEdit();
                    setEnterPressCount(0);
                  }
                }}
                style={{
                  width: window.innerWidth <= 768 ? "100%" : "400px",
                  height: "auto",
                  minHeight: window.innerWidth <= 768 ? "120px" : "120px",
                  maxHeight: window.innerWidth <= 768 ? "200px" : "300px",
                  padding: "12px",
                  border: "1px solid #ddd",
                  borderRadius: "6px",
                  fontSize: "16px",
                  lineHeight: "1.5",
                  resize: window.innerWidth <= 768 ? "none" : "both",
                  fontFamily: "inherit",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  overflowWrap: "break-word",
                  overflow: "hidden",
                  boxSizing: "border-box",
                }}
                placeholder="テキストを入力してください..."
                autoFocus
                ref={(textarea) => {
                  if (textarea) {
                    // 初期表示時に高さ調整を適用
                    setTimeout(() => adjustTextareaHeight(textarea), 100);
                  }
                }}
              />
          <div style={{
                display: "flex", 
                flexDirection: window.innerWidth <= 768 ? "column" : "row",
                gap: window.innerWidth <= 768 ? 6 : 8, 
                marginTop: 12 
              }}>
                                      <button onClick={finishInlineEdit} style={styles.btnPrimarySm}>✓ 保存</button>
                      <button onClick={cancelInlineEdit} style={styles.btnGhostSm}>✖ キャンセル</button>
          </div>
            </div>
          ) : (
            <div>
              <canvas
                ref={inkCanvasRef}
                width={window.innerWidth <= 768 ? 280 : 300}
                height={window.innerWidth <= 768 ? 140 : 150}
                style={{
                  width: window.innerWidth <= 768 ? "100%" : "300px",
                  height: window.innerWidth <= 768 ? "140px" : "150px",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                  background: "#fff",
                  cursor: "crosshair",
                  touchAction: "none",
                }}
                onMouseDown={startInkDrawing}
                onMouseMove={drawInk}
                onMouseUp={stopInkDrawing}
                onMouseLeave={stopInkDrawing}
                onTouchStart={startInkDrawing}
                onTouchMove={drawInk}
                onTouchEnd={stopInkDrawing}
              />
                  <div style={{
                display: "flex", 
                flexDirection: window.innerWidth <= 768 ? "column" : "row",
                gap: window.innerWidth <= 768 ? 6 : 8, 
                marginTop: 8 
              }}>
                                      <button onClick={recognizeInk} style={styles.btnPrimarySm}>✍️ 認識</button>
                      <button onClick={clearInk} style={styles.btnGhostSm}>🧹 クリア</button>
                      <button onClick={cancelInlineEdit} style={styles.btnGhostSm}>✖ キャンセル</button>
                  </div>
                </div>
          )}
            </div>
        )}
        
      <div style={styles.main}>
        {/* ===== 三段：原文 → 折り返し → 翻訳 ===== */}
        {visibleText ? (
          <div style={styles.card}>
            {/* 1) 原文：改行対応タイル（太字+縁取り / なぞり＆タップ可） */}
            <div ref={topRef} style={{ position: "relative", minHeight: 76, marginBottom: 10 }}>
              {tilePositions.map((c) => {
                // 文節モードの場合は文節単位、そうでない場合は文字単位で選択状態を判定
                const gIdx = isBunsetsuMode && bunsetsuGroups.length > 0 
                  ? charToGroup.get(c.index) 
                  : c.index;
                const selected = gIdx !== undefined && selectedGroups.has(gIdx);
                return (
                  <svg
                    key={c.id}
                style={{
                      position: "absolute",
                      left: `${c.x}px`,
                      top: `${c.y}px`,
                      transform: "translate(-50%,-50%)",
                      cursor: selectedGroups.size > 0 ? "pointer" : "crosshair", // 選択状態でのみクリック可能
                      zIndex: 10, // オーバーレイより下だが見える位置
                      backgroundColor: selected ? "rgba(9, 111, 202, 0.2)" : "transparent",
                      borderRadius: selected ? "4px" : "0px",
                      padding: selected ? "2px 4px" : "0px",
                      borderBottom: selected ? "3px solid #096FCA" : "none",
                    }}
                    width={c.charSize * 1.2}
                    height={c.charSize * 1.2}
                    viewBox={`0 0 ${c.charSize * 1.2} ${c.charSize * 1.2}`}
                  >
                    <text
                      x="50%"
                      y="50%"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={c.charSize}
                      fontWeight="800"
                      fill="#374151"
                      stroke="#FFFFFF"
                      strokeWidth="2"
                      paintOrder="stroke fill"
                      letterSpacing="0.5px"
                    >
                      {c.char === " " ? "\u00A0" : c.char}
                    </text>
                  </svg>
                );
              })}

              {/* なぞりオーバーレイ */}
          <div
            ref={overlayRef}
            style={{
              ...styles.overlay,
              zIndex: 15, // 文字より上に配置
              pointerEvents: "auto", // 常にイベントを受け取る
            }}
              onPointerDown={startDrawPointer}
              onPointerMove={moveDrawPointer}
              onPointerUp={stopDrawPointer}
              onPointerLeave={stopDrawPointer}
            >
                            {isDrawing && drawPath.length > 1 && (
                  <svg style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                <path
                      d={`M ${drawPath.map((p) => `${p.x},${p.y}`).join(" L ")}`}
                      stroke={hasSignificantDirectionChanges(drawPath) ? "#096FCA" : "#FF6B6B"}
                      strokeWidth={4}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.9}
                      filter="url(#scribble)"
                    />
                    <defs>
                      <filter id="scribble">
                        <feGaussianBlur stdDeviation="1" />
                        <feOffset dx="0" dy="0" />
                        <feMerge>
                          <feMergeNode />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
              </svg>
            )}
          </div>

                            {/* 選択時のフローティング操作 */}
              {mode === "selecting" && floatPos && selectedGroups.size > 0 && !inlineEditMode && (
                <div style={{ 
                  position: "absolute", 
                  left: floatPos.x, 
                  top: floatPos.y, 
                  display: "flex", 
                  flexDirection: window.innerWidth <= 768 ? "column" : "row",
                  gap: 8,
                  zIndex: 1000,
                  pointerEvents: "auto",
                  "@media (max-width: 768px)": {
                    flexDirection: "column",
                    gap: 6,
                    left: Math.max(10, Math.min(floatPos.x, window.innerWidth - 200)),
                    top: Math.max(10, Math.min(floatPos.y, window.innerHeight - 200)),
                  },
                }}>
                                    <button onClick={handleDelete} style={styles.btnDangerSm}>🗑 削除</button>
                  <button onClick={() => startInlineEdit('keyboard')} style={styles.btnPrimarySm}>⌨️ キーボード修正</button>
                  <button onClick={() => startInlineEdit('ink')} style={styles.btnPrimarySm}>✍️ 手書き修正</button>
                  <button onClick={() => setSelectedGroups(new Set())} style={styles.btnGhostSm}>
                    ✖ キャンセル
              </button>
                </div>
              )}


                      </div>

                        {/* 2) 折り返し（日本語） */}
                      <div style={{
              marginBottom: 14, 
              opacity: 0.95,
              fontWeight: 800,
              letterSpacing: "0.5px",
              textAlign: "left"
            }}>
              <svg width="100%" height="30" preserveAspectRatio="xMinYMid meet" style={{ overflow: "visible" }}>
                <text
                  x="20"
                  y="20"
                  textAnchor="start"
                  dominantBaseline="middle"
                  fontSize="clamp(16px, 4vw, 20px)"
                  fontWeight="800"
                  fill="#374151"
                  stroke="#FFFFFF"
                  strokeWidth="clamp(1px, 0.2vw, 2px)"
                  paintOrder="stroke fill"
                  letterSpacing="0.5px"
                  style={{ wordWrap: "break-word", overflowWrap: "break-word" }}
                >
                  {truncateText(triplet.back, 60)}
                </text>
              </svg>
                      </div>
            
                        {/* 3) 翻訳（選択言語） */}
                      <div style={{
              fontWeight: 800,
              letterSpacing: "0.5px",
              textAlign: "left"
            }}>
              <svg width="100%" height="60" preserveAspectRatio="xMinYMid meet" style={{ overflow: "visible" }}>
                <text
                  x="20"
                  y="40"
                  textAnchor="start"
                  dominantBaseline="middle"
                  fontSize="clamp(24px, 8vw, 42px)"
                  fontWeight="800"
                  fill="#374151"
                  stroke="#FFFFFF"
                  strokeWidth="clamp(1px, 0.2vw, 2px)"
                  paintOrder="stroke fill"
                  letterSpacing="0.5px"
                  style={{ wordWrap: "break-word", overflowWrap: "break-word" }}
                >
                  {truncateText(triplet.trans, 40)}
                </text>
              </svg>
                    </div>
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


    </div>
  );
};

/* ===================== スタイル ===================== */
// CSSアニメーションのキーフレーム
const keyframes = `
  @keyframes float {
    0% { 
      transform: translateY(0px) scale(1);
      opacity: 0.8;
    }
    25% { 
      transform: translateY(-3px) scale(1.02);
      opacity: 1;
    }
    50% { 
      transform: translateY(-1px) scale(1.05);
      opacity: 0.9;
    }
    75% { 
      transform: translateY(-4px) scale(1.03);
      opacity: 1;
    }
    100% { 
      transform: translateY(0px) scale(1);
      opacity: 0.8;
    }
  }
  
  @keyframes ripple {
    0% {
      transform: scale(0);
      opacity: 1;
    }
    100% {
      transform: scale(2);
      opacity: 0;
    }
  }
  
  @keyframes glow {
    0%, 100% {
      box-shadow: 0 0 5px rgba(59, 130, 246, 0.5);
    }
    50% {
      box-shadow: 0 0 20px rgba(59, 130, 246, 0.8), 0 0 30px rgba(59, 130, 246, 0.6);
    }
  }
`;



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
    "@media (max-width: 768px)": {
      padding: "16px 20px",
    },
  },
  title: { 
    margin: 0, 
    fontSize: 28, 
    fontWeight: 800,
    "@media (max-width: 768px)": {
      fontSize: 24,
    },
  },
  subtitle: { 
    margin: "6px 0 0", 
    opacity: 0.95,
    "@media (max-width: 768px)": {
      fontSize: "14px",
    },
  },
  toolbar: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: "12px",
    padding: "24px 32px",
    marginBottom: 32,
    display: "flex",
    flexDirection: "column",
    gap: 24,
    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
  },
  toolbarMain: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  toolbarInput: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  toolbarInfo: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    flexWrap: "wrap",
    fontSize: 14,
  },
  btnBlue: {
    padding: "16px 24px",
    background: "#096FCA",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontWeight: "600",
    fontSize: "16px",
    letterSpacing: "0.2px",
    cursor: "pointer",
    transition: "all 0.2s ease",
    "@media (max-width: 768px)": {
      padding: "14px 20px",
      fontSize: "15px",
      minWidth: "100px",
    },
  },
  btnPurple: {
    padding: "16px 24px",
    background: "#FF7669",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontWeight: "600",
    fontSize: "16px",
    letterSpacing: "0.2px",
    cursor: "pointer",
    transition: "all 0.2s ease",
    "@media (max-width: 768px)": {
      padding: "14px 20px",
      fontSize: "15px",
      minWidth: "100px",
    },
  },
  btnGhost: {
    padding: "16px 24px",
    background: "#fff",
    color: "#374151",
    border: "2px solid #e5e7eb",
    borderRadius: "8px",
    fontWeight: "600",
    fontSize: "16px",
    letterSpacing: "0.2px",
    cursor: "pointer",
    transition: "all 0.2s ease",
    "@media (max-width: 768px)": {
      padding: "14px 20px",
      fontSize: "15px",
      minWidth: "100px",
    },
  },
  btnDanger: {
    padding: "16px 24px",
    background: "#FF7669",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontWeight: "600",
    fontSize: "16px",
    letterSpacing: "0.2px",
    cursor: "pointer",
    transition: "all 0.2s ease",
    "@media (max-width: 768px)": {
      padding: "14px 20px",
      fontSize: "15px",
      minWidth: "100px",
    },
  },
  select: { 
    padding: "8px 12px", 
    border: "1px solid #e5e7eb", 
    borderRadius: 8,
    fontSize: "14px",
    minWidth: "120px",
  },
  listeningIndicator: {
    color: "#ef4444",
    fontWeight: 600,
    fontSize: "14px",
  },
  textCount: {
    color: "#6b7280",
    fontSize: "14px",
  },
  main: { 
    maxWidth: 1100, 
    margin: "24px auto", 
    padding: "0 16px",
    "@media (max-width: 768px)": {
      padding: "0 12px",
      margin: "16px auto",
    },
  },
  card: {
    background: "#DDDDDD",
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    boxShadow: "0 10px 26px rgba(0,0,0,.06)",
    padding: 24,
    "@media (max-width: 768px)": {
      padding: 16,
      borderRadius: 12,
    },
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
    padding: "12px 20px",
    border: "1px solid #e5e7eb",
    background: "#fff",
    borderRadius: "8px",
    fontWeight: "600",
    fontSize: "14px",
    color: "#374151",
    cursor: "pointer",
    minHeight: "40px",
    minWidth: "100px",
    userSelect: "none",
    touchAction: "manipulation",
    transition: "all 0.2s ease",
  },
  btnDangerSm: {
    padding: "12px 20px",
    border: "none",
    background: "#FF7669",
    color: "#fff",
    borderRadius: "8px",
    fontWeight: "600",
    fontSize: "14px",
    cursor: "pointer",
    minHeight: "40px",
    minWidth: "100px",
    userSelect: "none",
    touchAction: "manipulation",
    transition: "all 0.2s ease",
  },
  btnPrimarySm: {
    padding: "12px 20px",
    border: "none",
    background: "#096FCA",
    color: "#fff",
    borderRadius: "8px",
    fontWeight: "600",
    fontSize: "14px",
    cursor: "pointer",
    minHeight: "40px",
    minWidth: "100px",
    userSelect: "none",
    touchAction: "manipulation",
    transition: "all 0.2s ease",
  },
};

export default ScribbleTranslator;
