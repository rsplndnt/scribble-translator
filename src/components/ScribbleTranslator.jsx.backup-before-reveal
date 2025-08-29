import React, { useState, useRef, useCallback, useEffect } from 'react';

// CORS対応の翻訳APIです
const translateWithMyMemory = async (text, targetLang) => {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ja|${targetLang}`;
    const response = await fetch(url);
    const data = await response.json();
    return data.responseData.translatedText;
  } catch (error) {
    console.error('Translation error:', error);
    return '翻訳エラー';
  }
};

// 折り返し翻訳用（他言語→日本語）
const translateToJapanese = async (text, sourceLang) => {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang}|ja`;
    const response = await fetch(url);
    const data = await response.json();
    return data.responseData.translatedText;
  } catch (error) {
    console.error('Back translation error:', error);
    return '翻訳エラー';
  }
};

// Google APIを使用した再変換候補生成
const generateReconversionCandidates = async (text) => {
  try {
    console.log(`Google API再変換開始: "${text}"`);
    
    // Google Translate APIを使用して複数の変換候補を生成
    const candidates = [];
    
    // 1. 元のテキストを含める
    candidates.push(text);
    
    // 2. ひらがな→漢字変換（日本語→英語→日本語で異なる候補を取得）
    if (/^[ひらがな]+$/.test(text) || /[ひらがな]/.test(text)) {
      try {
        // 日本語→英語
        const englishResult = await translateWithGoogle(text, 'en');
        console.log(`日→英: "${text}" → "${englishResult}"`);
        
        // 英語→日本語（複数の翻訳エンジンを模擬）
        const backToJapanese = await translateWithGoogle(englishResult, 'ja');
        console.log(`英→日: "${englishResult}" → "${backToJapanese}"`);
        
        if (backToJapanese && backToJapanese !== text) {
          candidates.push(backToJapanese);
        }
        
        // さらに韓国語経由でも試行
        const koreanResult = await translateWithGoogle(text, 'ko');
        const fromKorean = await translateWithGoogle(koreanResult, 'ja');
        if (fromKorean && fromKorean !== text && !candidates.includes(fromKorean)) {
          candidates.push(fromKorean);
        }
        
        // 中国語経由でも試行
        const chineseResult = await translateWithGoogle(text, 'zh');
        const fromChinese = await translateWithGoogle(chineseResult, 'ja');
        if (fromChinese && fromChinese !== text && !candidates.includes(fromChinese)) {
          candidates.push(fromChinese);
        }
        
      } catch (error) {
        console.warn('Google API変換エラー:', error);
      }
    }
    
    // 3. 漢字→ひらがな変換（ローマ字経由）
    if (/[漢字]/.test(text) || /[\u4e00-\u9faf]/.test(text)) {
      try {
        // より自然な読みを取得するため、説明文として翻訳
        const explanation = await translateWithGoogle(`「${text}」の読み方`, 'en');
        const backExplanation = await translateWithGoogle(explanation, 'ja');
        
        // 簡単な後処理で読みを抽出
        const hiraganaMatch = backExplanation.match(/([ひらがな]+)/);
        if (hiraganaMatch && !candidates.includes(hiraganaMatch[1])) {
          candidates.push(hiraganaMatch[1]);
        }
      } catch (error) {
        console.warn('読み変換エラー:', error);
      }
    }
    
    // 4. フォールバック: 基本的なパターンマッチング
    const fallbackCandidates = generateFallbackCandidates(text);
    fallbackCandidates.forEach(candidate => {
      if (!candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    });
    
    console.log(`再変換候補生成完了: ${candidates.length}件`, candidates);
    return candidates.slice(0, 8); // 最大8候補
    
  } catch (error) {
    console.error('Google API再変換エラー:', error);
    // フォールバック: 基本的なパターンマッチング
    return generateFallbackCandidates(text);
  }
};

// Google Translate APIの改良版（エラーハンドリング強化）
const translateWithGoogle = async (text, targetLang, retries = 2) => {
  for (let i = 0; i < retries; i++) {
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      const result = data[0][0][0];
      
      // 結果の検証
      if (result && result.trim() && result !== text) {
        return result.trim();
      }
      
      throw new Error('Invalid translation result');
      
    } catch (error) {
      console.warn(`翻訳試行 ${i+1}/${retries} 失敗:`, error.message);
      
      if (i === retries - 1) {
        throw error;
      }
      
      // リトライ前の待機（レート制限対策）
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
};

// フォールバック用の基本パターンマッチング
const generateFallbackCandidates = (text) => {
  const patterns = [
    // よく使われる変換パターン
    { from: 'きみ', to: ['君', '黄身', '公'] },
    { from: 'うつくしい', to: ['美しい', '麗しい'] },
    { from: 'こんにちは', to: ['今日は', 'こんにちは'] },
    { from: 'ありがとう', to: ['有り難う', 'ありがとう', '有難う'] },
    { from: 'にほん', to: ['日本', '二本'] },
    { from: 'わたし', to: ['私', '渡し', 'わたくし'] },
    { from: 'あなた', to: ['貴方', 'あなた', '貴女'] },
    
    // 逆変換
    { from: '君', to: ['きみ', '黄身'] },
    { from: '美しい', to: ['うつくしい', '麗しい'] },
    { from: '日本', to: ['にほん', 'にっぽん'] },
    { from: '私', to: ['わたし', 'わたくし'] },
    
    // 複合語
    { from: 'きみはうつくしい', to: ['君は美しい', '黄身は美しい'] },
    { from: '君は美しい', to: ['きみはうつくしい', '黄身は美しい'] },
  ];
  
  // 完全一致
  const exactMatch = patterns.find(p => p.from === text);
  if (exactMatch) {
    return [text, ...exactMatch.to];
  }
  
  // 部分一致
  const candidates = [text];
  patterns.forEach(pattern => {
    if (text.includes(pattern.from)) {
      pattern.to.forEach(replacement => {
        const converted = text.replace(pattern.from, replacement);
        if (converted !== text && !candidates.includes(converted)) {
          candidates.push(converted);
        }
      });
    }
  });
  
  return candidates.slice(0, 6);
};

const ScribbleTranslator = () => {
  // ——— ① State/Ref フック群 ———
  const containerRef   = useRef(null);
  const overlayRef     = useRef(null);
  const tokenizerRef   = useRef(null);

  const initialText = 'きみはうつくしい。この文章の文字を選択してから翻訳や再変換ができます。ぐしゃぐしゃ描いて文字を選択し、ボタンを押してください。';

  const [textChars, setTextChars]           = useState([]);
  const [selectedChars, setSelectedChars]   = useState(new Set());
  const [currentPath, setCurrentPath]       = useState([]);
  const [confirmButtons, setConfirmButtons] = useState(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [translations, setTranslations]     = useState({});
  const [isTranslating, setIsTranslating]   = useState(false);
  const [showTranslations, setShowTranslations] = useState(false);
  const [backTranslations, setBackTranslations] = useState({});
  const [isBackTranslating, setIsBackTranslating] = useState(false);
  const [showBackTranslations, setShowBackTranslations] = useState(false);
  const [selectedText, setSelectedText]     = useState('');
  const [bunsetsuGroups, setBunsetsuGroups] = useState([]);
  const [isListening, setIsListening]       = useState(false);
  const [recognition, setRecognition]       = useState(null);
  const [currentText, setCurrentText]       = useState(initialText);
  const [isTokenizerReady, setIsTokenizerReady] = useState(false);
  const [isBunsetsuMode, setIsBunsetsuMode] = useState(true);
  const [isDrawing, setIsDrawing]           = useState(false);
  const [kuromojiStatus, setKuromojiStatus] = useState('initializing'); // initializing, ready, error
  // 再変換機能用の状態（追加）
  const [showReconversion, setShowReconversion] = useState(false);
  const [reconversionCandidates, setReconversionCandidates] = useState([]);

  const targetLanguages = [
    { code: 'en', name: '英語',   flag: '🇺🇸' },
    { code: 'ko', name: '韓国語', flag: '🇰🇷' },
    { code: 'zh', name: '中国語', flag: '🇨🇳' },
  ];

  // ——— 選択解除ヘルパー ———
  const cancelSelection = useCallback(() => {
    setSelectedChars(new Set());
    setIsSelectionMode(false);
    setConfirmButtons(null);
    setShowTranslations(false);
    setSelectedText('');
    setTranslations({});
    setBackTranslations({});
    setShowBackTranslations(false);
    setShowReconversion(false); // 追加
    setReconversionCandidates([]); // 追加
  }, []);

  // ——— 削除処理ハンドラ ———
  const handleDelete = useCallback(() => {
    if (selectedChars.size === 0) return;
    const newText = currentText
      .split('')
      .filter((_, i) => !selectedChars.has(i))
      .join('');
    setCurrentText(newText);
    cancelSelection();
  }, [selectedChars, currentText, cancelSelection]);

  // ——— Delete/Backspace キー監視 ———
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedChars.size > 0) {
        handleDelete();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedChars, handleDelete]);

  // ——— Kuromoji トークナイザー初期化（改善版） ———
  useEffect(() => {
    const initializeTokenizer = async () => {
      try {
        setKuromojiStatus('initializing');
        
        if (typeof window.kuromoji === 'undefined') {
          console.error('Kuromoji library not loaded');
          setKuromojiStatus('error');
          setIsTokenizerReady(true);
          return;
        }

        // 複数の辞書パスを試行
        const dictPaths = [
          './dict/',                                    // ローカル（publicフォルダ）
          '/dict/',                                     // ルート相対
          './kuromoji/dict/',                          // kuromoji フォルダ内
          'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/', // CDN
        ];

        let tokenizer = null;
        let successPath = null;

        for (const dicPath of dictPaths) {
          try {
            console.log(`Trying kuromoji with: ${dicPath}`);
            
            tokenizer = await new Promise((resolve, reject) => {
              const timeoutId = setTimeout(() => {
                reject(new Error('Timeout'));
              }, 5000); // 5秒タイムアウト

              window.kuromoji.builder({ dicPath }).build((err, result) => {
                clearTimeout(timeoutId);
                if (err) {
                  reject(err);
                } else {
                  resolve(result);
                }
              });
            });

            if (tokenizer) {
              successPath = dicPath;
              break;
            }
          } catch (err) {
            console.warn(`Failed with ${dicPath}:`, err.message);
          }
        }

        if (tokenizer) {
          console.log(`Kuromoji initialized successfully with: ${successPath}`);
          tokenizerRef.current = tokenizer;
          setKuromojiStatus('ready');
          setIsTokenizerReady(true);
        } else {
          throw new Error('All dictionary paths failed');
        }

      } catch (error) {
        console.error('Kuromoji initialization error:', error);
        setKuromojiStatus('error');
        setIsTokenizerReady(true);
      }
    };

    initializeTokenizer();
  }, []);

  // ——— AI 文節分割ロジック ———
  const analyzeBunsetsuWithAI = useCallback((text) => {
    if (!tokenizerRef.current || !isBunsetsuMode || kuromojiStatus !== 'ready') {
      return text.split('').map((char, idx) => ({
        indices: [idx],
        text: char,
        start: idx,
        end: idx,
      }));
    }
    
    try {
      const tokens = tokenizerRef.current.tokenize(text);
      const groups = [];
      let currentGroup = [];
      let currentIndices = [];
      let charIndex = 0;
      let groupStart = 0;

      tokens.forEach((token, tokenIndex) => {
        const len = token.surface_form.length;
        const inds = Array.from({ length: len }, (_, i) => charIndex + i);
        currentGroup.push(token.surface_form);
        currentIndices.push(...inds);

        let shouldSplit = (
          token.pos === '助詞' ||
          token.pos === '助動詞' ||
          token.surface_form.match(/[、。！？]/) ||
          token.pos_detail_1 === '句点' ||
          token.pos_detail_1 === '読点'
        );
        
        if (!shouldSplit && tokenIndex < tokens.length - 1) {
          const next = tokens[tokenIndex + 1];
          if ((token.pos === '動詞' || token.pos === '形容詞') &&
              (next.pos === '助詞' || next.pos === '名詞')) {
            shouldSplit = true;
          }
        }

        if (shouldSplit || tokenIndex === tokens.length - 1) {
          groups.push({
            indices: [...currentIndices],
            text: currentGroup.join(''),
            start: groupStart,
            end: charIndex + len - 1,
            tokens: [...currentGroup],
            features: tokens.slice(groupStart, tokenIndex + 1).map(t => ({
              surface: t.surface_form, pos: t.pos, detail: t.pos_detail_1
            }))
          });
          currentGroup = [];
          currentIndices = [];
          groupStart = charIndex + len;
        }

        charIndex += len;
      });

      return groups;
    } catch (error) {
      console.error('Bunsetsu analysis error:', error);
      return text.split('').map((char, idx) => ({
        indices: [idx],
        text: char,
        start: idx,
        end: idx,
      }));
    }
  }, [isBunsetsuMode, kuromojiStatus]);

  // ─── 音声認識の初期化 ───
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new SpeechRecognition();

      rec.lang = 'ja-JP';
      rec.interimResults = true;
      rec.continuous    = true;

      rec.onresult = (e) => {
        let finalTranscript = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) {
            finalTranscript += e.results[i][0].transcript;
          }
        }
        if (finalTranscript) {
          setCurrentText(prev => prev + finalTranscript);
        }
      };

      rec.onerror = () => setIsListening(false);
      rec.onend   = () => setIsListening(false);

      setRecognition(rec);
    }
  }, []);

  const toggleVoiceInput = useCallback(() => {
    if (!recognition) {
      alert('ブラウザが音声認識に対応していません');
      return;
    }
    if (isListening) {
      recognition.stop();
      setIsListening(false);
    } else {
      if (currentText !== initialText && window.confirm('テキストをクリアして音声入力を開始しますか？')) {
        setCurrentText('');
      }
      recognition.start();
      setIsListening(true);
    }
  }, [recognition, isListening, currentText]);

  // ——— currentText 変更時：文字 & 文節更新 ———
  useEffect(() => {
    setTextChars(currentText.split('').map((ch, i) => ({ char: ch, id: `char-${i}` })));
    setBunsetsuGroups(analyzeBunsetsuWithAI(currentText));
    cancelSelection();
  }, [currentText, analyzeBunsetsuWithAI, cancelSelection]);

  // ——— selectedChars 変更時：テキスト & ボタン位置更新 ———
  useEffect(() => {
    if (selectedChars.size > 0) {
      const str = Array.from(selectedChars).sort((a, b) => a - b)
        .map(i => textChars[i]?.char || '').join('');
      setSelectedText(str);
      updateConfirmButtonPosition();
    } else {
      setSelectedText('');
      setConfirmButtons(null);
    }
  }, [selectedChars, textChars]);

  // ——— マウスポジション取得 ———
  const getMousePos = useCallback((e) => {
    if (!overlayRef.current) return { x: 0, y: 0 };
    const r = overlayRef.current.getBoundingClientRect();
    const x = (e.touches?.[0]?.clientX ?? e.clientX) - r.left;
    const y = (e.touches?.[0]?.clientY ?? e.clientY) - r.top;
    return { x, y };
  }, []);

  // ——— 文字なぞり開始 ———
  const startDrawing = useCallback((e) => {
    e.preventDefault();
    setIsDrawing(true);
    setCurrentPath([getMousePos(e)]);
    cancelSelection();
  }, [getMousePos, cancelSelection]);

  // ——— 文字なぞり継続 ———
  const draw = useCallback((e) => {
    if (!isDrawing) return;
    e.preventDefault();
    setCurrentPath(prev => [...prev, getMousePos(e)]);
  }, [isDrawing, getMousePos]);

  // ——— 文字なぞり終了 ———
  const stopDrawing = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (!currentPath.length) return;
    const spans = containerRef.current.querySelectorAll('.char-span');
    const rect = overlayRef.current.getBoundingClientRect();
    const hits = new Set();

    spans.forEach((span, idx) => {
      const r = span.getBoundingClientRect();
      const cx = r.left + r.width/2, cy = r.top + r.height/2;
      if (currentPath.some(p => {
        const ax = p.x + rect.left, ay = p.y + rect.top;
        return Math.hypot(ax-cx, ay-cy) < Math.max(r.width,r.height)*0.7;
      })) {
        if (isBunsetsuMode && kuromojiStatus === 'ready') {
          const g = bunsetsuGroups.find(g => g.indices.includes(idx));
          g?.indices.forEach(i => hits.add(i));
        } else {
          hits.add(idx);
        }
      }
    });

    if (hits.size > 0) {
      setIsSelectionMode(true);
      setSelectedChars(hits);
    }
    setCurrentPath([]);
    updateConfirmButtonPosition();
  }, [isDrawing, currentPath, bunsetsuGroups, isBunsetsuMode, kuromojiStatus]);

  // ——— 確認ボタン位置計算 ———
  const updateConfirmButtonPosition = useCallback(() => {
    if (!containerRef.current || selectedChars.size === 0) return;
    const spans = containerRef.current.querySelectorAll('.char-span');
    const rect = overlayRef.current.getBoundingClientRect();
    const pts = Array.from(selectedChars).map(i => {
      const r = spans[i].getBoundingClientRect();
      return { x: r.left + r.width/2 - rect.left, y: r.top + r.height/2 - rect.top };
    });
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const left = Math.min(...xs, Infinity), right = Math.max(...xs, 0);
    const bottom = Math.max(...ys, 0);
    setConfirmButtons({ x:(left+right)/2, y:bottom+20, count:selectedChars.size });
  }, [selectedChars]);

  // ——— 翻訳実行 ———
  const handleTranslate = useCallback(async () => {
    if (!selectedText.trim() || isTranslating) return;
    setIsTranslating(true);
    setShowTranslations(true);
    setShowBackTranslations(false);
    setShowReconversion(false); // 追加
    setBackTranslations({});
    const results = {};
    for (const lang of targetLanguages) {
      results[lang.code] = await translateWithMyMemory(selectedText.trim(), lang.code);
    }
    setTranslations(results);
    setIsTranslating(false);
  }, [selectedText, isTranslating]);

  // ——— 折り返し翻訳実行 ———
  const handleBackTranslate = useCallback(async () => {
    if (isBackTranslating) return;
    setIsBackTranslating(true);
    setShowBackTranslations(true);
    setShowReconversion(false); // 追加
    const results = {};
    
    for (const lang of targetLanguages) {
      if (translations[lang.code]) {
        // 各言語から日本語に翻訳
        results[lang.code] = await translateToJapanese(translations[lang.code], lang.code);
      }
    }
    
    setBackTranslations(results);
    setIsBackTranslating(false);
  }, [translations, isBackTranslating]);

  // ——— 再変換機能（Google API使用） ———
  const handleReconversion = useCallback(async () => {
    if (!selectedText.trim()) return;
    
    setShowReconversion(true);
    setShowTranslations(false);
    setShowBackTranslations(false);
    setReconversionCandidates(['🔄 候補を生成中...']); // ローディング表示
    
    try {
      const candidates = await generateReconversionCandidates(selectedText.trim());
      setReconversionCandidates(candidates);
    } catch (error) {
      console.error('再変換エラー:', error);
      setReconversionCandidates([selectedText, '❌ 再変換に失敗しました']);
    }
  }, [selectedText]);

  // ——— 再変換適用機能（追加） ———
  const applyReconversion = useCallback((newText) => {
    const selectedIndices = Array.from(selectedChars).sort((a, b) => a - b);
    const newTextArray = currentText.split('');
    
    // 選択された文字を新しいテキストで置き換え
    const newTextChars = newText.split('');
    
    // 古い文字を削除
    for (let i = selectedIndices.length - 1; i >= 0; i--) {
      newTextArray.splice(selectedIndices[i], 1);
    }
    
    // 新しい文字を挿入
    const insertIndex = selectedIndices[0];
    newTextChars.forEach((char, idx) => {
      newTextArray.splice(insertIndex + idx, 0, char);
    });
    
    setCurrentText(newTextArray.join(''));
    setShowReconversion(false);
    cancelSelection();
  }, [selectedChars, currentText, cancelSelection]);

  // ——— 文節モード切替 ———
  const toggleBunsetsuMode = () => {
    setIsBunsetsuMode(m => !m);
    cancelSelection();
  };

  const isBunsetsuEnd = idx => bunsetsuGroups.some(g => g.end === idx);

  // ——— スタイル定義 ———
  const styles = {
    container: {
      width: '100%', minHeight: '100vh',
      display: 'flex', flexDirection: 'column',
      backgroundColor: '#f8fafc',
      fontFamily: '"Noto Sans JP", system-ui, -apple-system, sans-serif'
    },
    header: {
      background: 'linear-gradient(135deg, #096FCA 0%, #76B7ED 100%)',
      color: 'white', padding: '24px 32px',
      boxShadow: '0 4px 20px rgba(9,111,202,0.3)'
    },
    title: { fontSize: '32px', fontWeight: 700, margin: 0, textShadow: '0 2px 4px rgba(0,0,0,0.1)' },
    subtitle: { color: '#E1F5FE', fontSize: '16px', margin: 0 },
    toolbar: {
      backgroundColor: 'white', padding: '16px 32px',
      borderBottom: '1px solid #e5e7eb',
      boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
      display: 'flex', justifyContent: 'space-between',
      alignItems: 'center', flexWrap: 'wrap', gap: '16px'
    },
    toolbarInfo: { fontSize: '14px', color: '#3A3E40', flex: 1 },
    toolbarButtons: { display: 'flex', gap: '12px', alignItems: 'center' },
    voiceButton: {
      padding: '8px 16px', border: 'none', borderRadius: '6px',
      fontSize: '14px', fontWeight: 500, cursor: 'pointer',
      backgroundColor: isListening ? '#ef4444' : '#3b82f6',
      color: 'white', transition: 'all 0.2s',
      boxShadow: isListening
        ? '0 2px 4px rgba(239,68,68,0.3)'
        : '0 2px 4px rgba(59,130,246,0.3)',
      display: 'flex', alignItems: 'center', gap: '6px'
    },
    resetButton: {
      padding: '8px 16px', border: 'none', borderRadius: '6px',
      fontSize: '14px', fontWeight: 500, cursor: 'pointer',
      backgroundColor: '#FF7669', color: 'white',
      transition: 'all 0.2s', boxShadow: '0 2px 4px rgba(255,118,105,0.3)'
    },
    bunsetsuToggle: {
      padding: '8px 16px', border: 'none', borderRadius: '6px',
      fontSize: '14px', fontWeight: 500, cursor: 'pointer',
      backgroundColor: 'transparent',
      color: '#3A3E40',
      transition: 'all 0.2s',
      display: 'flex', alignItems: 'center', gap: '12px',
      opacity: kuromojiStatus === 'ready' ? 1 : 0.6,
    },
    toggleSwitch: {
      position: 'relative',
      width: '40px', height: '22px',
      backgroundColor: isBunsetsuMode ? '#10b981' : '#e5e7eb',
      borderRadius: '11px',
      transition: 'all 0.2s',
      cursor: 'pointer'
    },
    toggleKnob: {
      position: 'absolute', top: '2px',
      left: isBunsetsuMode ? '20px' : '2px',
      width: '18px', height: '18px',
      backgroundColor: 'white',
      borderRadius: '50%',
      transition: 'all 0.2s',
      boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
    },
    main: { flex: 1, padding: '32px', maxWidth: '1200px', margin: '0 auto', width: '100%' },
    textContainer: {
      position: 'relative', backgroundColor: 'white',
      padding: '40px', borderRadius: '12px',
      boxShadow: '0 8px 25px rgba(0,0,0,0.1)',
      border: '1px solid #e5e7eb', marginBottom: '32px'
    },
    textArea: {
      position: 'relative', zIndex: 10, userSelect: 'none',
      fontSize: '24px', lineHeight: 1.8, color: '#3A3E40',
      minHeight: '100px'
    },
    charSpan: {
      display: 'inline-block', transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)',
      borderRadius: '4px', cursor: 'pointer',
      position: 'relative', zIndex: isSelectionMode ? 25 : 10,
      pointerEvents: isSelectionMode ? 'auto' : 'none'
    },
    selectedChar: {
      backgroundColor: '#E3F2FD', border: '2px solid #096FCA',
      borderRadius: '6px', padding: '4px 6px', margin: '0 2px',
      transform: 'scale(1.05)', boxShadow: '0 2px 8px rgba(9,111,202,0.2)'
    },
    bunsetsuBorder: { borderRight: '2px dotted #FF7669', paddingRight: '3px', marginRight: '3px' },
    overlay: { position: 'absolute', top:0, left:0, right:0, bottom:0, zIndex:20 },
    buttons: { position: 'absolute', zIndex:30, display:'flex', gap:'12px', flexWrap: 'wrap' },
    translateButton: {
      padding:'12px 20px', border:'none', borderRadius:'8px',
      fontSize:'14px', fontWeight:600, cursor:'pointer',
      display:'flex', alignItems:'center', gap:'8px',
      boxShadow:'0 4px 12px rgba(16,185,129,0.3)'
    },
    // 再変換ボタンのスタイル（追加）
    reconversionButton: {
      padding: '12px 20px', border: 'none', borderRadius: '8px',
      fontSize: '14px', fontWeight: 600, cursor: 'pointer',
      backgroundColor: '#f59e0b', color: 'white',
      transition: 'background-color 0.2s',
      display: 'flex', alignItems: 'center', gap: '8px',
      boxShadow: '0 4px 12px rgba(245,158,11,0.3)'
    },
    cancelButton: {
      padding:'12px 20px', border:'none', borderRadius:'8px',
      fontSize:'14px', fontWeight:600, cursor:'pointer',
      backgroundColor:'#96A0A6', color:'white'
    },
    translationContainer: {
      backgroundColor:'white', borderRadius:'12px',
      boxShadow:'0 8px 25px rgba(0,0,0,0.1)',
      border:'1px solid #e5e7eb', padding:'32px'
    },
    translationTitle: {
      fontSize:'24px', fontWeight:700, color:'#096FCA',
      marginBottom:'20px', display:'flex', alignItems:'center', gap:'12px'
    },
    selectedTextBox: {
      backgroundColor:'#F0F8FF', padding:'16px',
      borderRadius:'8px', border:'1px solid #B3D9FF',
      marginBottom:'24px'
    },
    translationGrid: { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(280px,1fr))', gap:'20px' },
    translationCard: {
      backgroundColor:'#FAFBFC', padding:'20px', borderRadius:'10px',
      border:'1px solid #E5E7EB', boxShadow:'0 2px 8px rgba(0,0,0,0.05)'
    },
    flagName: { display:'flex', alignItems:'center', gap:'10px', marginBottom:'12px' },
    flag: { fontSize:'24px' },
    langName: { fontSize:'16px', fontWeight:600, color:'#3A3E40' },
    translatedText: { fontSize:'16px', lineHeight:1.5, minHeight:'24px', color:'#1f2937' },
    loadingText: { fontStyle:'italic', color:'#96A0A6' },
    emptyState: { textAlign:'center', color:'#96A0A6', fontSize:'16px', padding:'40px 0' },
    aiStatus: {
      display:'inline-flex', alignItems:'center', gap:'6px',
      padding:'4px 12px', borderRadius:'16px',
      backgroundColor: kuromojiStatus === 'ready' ? '#d1fae5' : 
                      kuromojiStatus === 'error' ? '#fee2e2' : '#fef3c7',
      color: kuromojiStatus === 'ready' ? '#065f46' : 
             kuromojiStatus === 'error' ? '#991b1b' : '#92400e',
      fontSize:'12px', fontWeight:500
    },
    backTranslateButton: {
      padding: '12px 24px', border: 'none', borderRadius: '8px',
      fontSize: '16px', fontWeight: 600, cursor: 'pointer',
      backgroundColor: '#8b5cf6', color: 'white',
      transition: 'all 0.2s', boxShadow: '0 4px 12px rgba(139,92,246,0.3)',
      display: 'flex', alignItems: 'center', gap: '8px',
      margin: '24px auto 0', justifyContent: 'center'
    },
    backTranslationBox: {
      backgroundColor: '#f3f4f6', padding: '20px',
      borderRadius: '10px', marginTop: '24px',
      border: '1px solid #d1d5db'
    },
    backTranslationTitle: {
      fontSize: '18px', fontWeight: 600, color: '#4b5563',
      marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px'
    },
    // 再変換用スタイル（追加）
    reconversionGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: '12px'
    },
    candidateButton: {
      padding: '12px 16px',
      backgroundColor: '#fef3c7',
      border: '2px solid #f59e0b',
      borderRadius: '8px',
      cursor: 'pointer',
      transition: 'all 0.2s',
      fontSize: '16px',
      textAlign: 'center'
    }
  };

  // ——— 文字選択ハンドラ ———
  const toggleCharSelection = useCallback((idx, e) => {
    e.stopPropagation();
    if (!isSelectionMode) setIsSelectionMode(true);
    setSelectedChars(prev => {
      const s = new Set(prev);
      if (s.has(idx)) {
        s.delete(idx);
      } else {
        if (isBunsetsuMode && kuromojiStatus === 'ready') {
          const g = bunsetsuGroups.find(g => g.indices.includes(idx));
          if (g) {
            const allSelected = g.indices.every(i => s.has(i));
            if (allSelected) {
              g.indices.forEach(i => s.delete(i));
            } else {
              g.indices.forEach(i => s.add(i));
            }
          }
        } else {
          s.add(idx);
        }
      }
      return s;
    });
  }, [isSelectionMode, isBunsetsuMode, bunsetsuGroups, kuromojiStatus]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>🎨 スクリブル翻訳・再変換</h1>
        <p style={styles.subtitle}>AI文節認識で、より自然な文字選択を実現</p>
      </div>

      <div style={styles.toolbar}>
        <div style={styles.toolbarInfo}>
          {isListening
            ? <span style={{ color:'#ef4444',fontWeight:500 }}>🎤 音声入力中…</span>
            : selectedChars.size > 0
              ? <span style={{ color:'#096FCA',fontWeight:500 }}>✨ {selectedChars.size}文字選択中: "{selectedText}"</span>
              : <span>📝 文字数: {textChars.length} | マウスで文字をなぞって選択</span>
          }
          {isTranslating && <span style={{ color:'#10b981',marginLeft:16,fontWeight:500 }}>🔄 翻訳処理中…</span>}
          <span style={{ ...styles.aiStatus, marginLeft:16 }}>
            {kuromojiStatus === 'ready' ? '🤖 AI文節認識: 有効' : 
             kuromojiStatus === 'error' ? '⚠️ 文字モードで動作中' : 
             '⏳ AI初期化中...'}
          </span>
        </div>
        <div style={styles.toolbarButtons}>
          <button onClick={toggleBunsetsuMode} style={styles.bunsetsuToggle} 
                  disabled={kuromojiStatus !== 'ready'}>
            文節モード
            <span style={styles.toggleSwitch}>
              <span style={styles.toggleKnob}></span>
            </span>
          </button>
          <button onClick={toggleVoiceInput} style={styles.voiceButton}>
            {isListening ? <>⏹️ 音声入力停止</> : <>🎤 音声入力</>}
          </button>
          <button onClick={() => setCurrentText(initialText)} style={styles.resetButton}>
            🔄 リセット
          </button>
        </div>
      </div>

      <div style={styles.main}>
        <div ref={containerRef} style={styles.textContainer}>
          <div style={styles.textArea}>
            {textChars.length > 0
              ? textChars.map((c, i) => (
                  <span
                    key={c.id}
                    className="char-span"
                    onClick={e => toggleCharSelection(i, e)}
                    style={{
                      ...styles.charSpan,
                      ...(selectedChars.has(i) ? styles.selectedChar : {}),
                      ...(isSelectionMode && !selectedChars.has(i)
                        ? { cursor:'pointer', padding:'2px 1px' }
                        : {}),
                      ...(isBunsetsuEnd(i) && !isSelectionMode && isBunsetsuMode && kuromojiStatus === 'ready'
                        ? styles.bunsetsuBorder
                        : {})
                    }}
                  >
                    {c.char === ' ' ? '\u00A0' : c.char}
                  </span>
                ))
              : <div style={styles.emptyState}>
                  {isListening ? '🎤 話してください…' : '🎤 音声入力ボタンを押して話してください'}
                </div>
            }
          </div>

          <div
            ref={overlayRef}
            style={{
              ...styles.overlay,
              pointerEvents: isSelectionMode ? 'none' : 'auto',
              cursor: isSelectionMode ? 'default' : 'crosshair'
            }}
            onMouseDown={!isSelectionMode ? startDrawing : undefined}
            onMouseMove={!isSelectionMode ? draw : undefined}
            onMouseUp={!isSelectionMode ? stopDrawing : undefined}
            onMouseLeave={!isSelectionMode ? stopDrawing : undefined}
            onTouchStart={!isSelectionMode ? startDrawing : undefined}
            onTouchMove={!isSelectionMode ? draw : undefined}
            onTouchEnd={!isSelectionMode ? stopDrawing : undefined}
          >
            {currentPath.length > 1 && (
              <svg style={{ position:'absolute',top:0,left:0,width:'100%',height:'100%',pointerEvents:'none' }}>
                <path
                  d={`M ${currentPath.map(p => `${p.x},${p.y}`).join(' L ')}`}
                  stroke="#096FCA" strokeWidth={4} fill="none"
                  strokeLinecap="round" strokeLinejoin="round" opacity={0.7}
                  filter="drop-shadow(0 2px 4px rgba(9,111,202,0.3))"
                />
              </svg>
            )}
          </div>

          {confirmButtons && selectedChars.size > 0 && (
            <div style={{
              ...styles.buttons,
              left: Math.max(20, confirmButtons.x - 150),
              top: confirmButtons.y
            }}>
              <button
                onClick={handleTranslate}
                disabled={isTranslating}
                style={{
                  ...styles.translateButton,
                  backgroundColor: isTranslating ? '#9ca3af' : '#10b981',
                  transform: isTranslating ? 'scale(0.95)' : 'scale(1)'
                }}
              >
                🌐 翻訳({confirmButtons.count})
              </button>
              
              {/* 再変換ボタン（追加） */}
              <button
                onClick={handleReconversion}
                style={styles.reconversionButton}
              >
                🔄 再変換({confirmButtons.count})
              </button>
              
              <button
                onClick={handleDelete}
                style={{
                  ...styles.cancelButton,
                  backgroundColor: '#ef4444',
                  color: 'white',
                }}
              >
                🗑️ 削除
              </button>
              <button
                onClick={cancelSelection}
                style={styles.cancelButton}
              >
                ✕ キャンセル
              </button>
            </div>
          )}
        </div>

        {isBunsetsuMode && bunsetsuGroups.length > 0 && kuromojiStatus === 'ready' && (
          <div style={{
            marginTop:'16px', padding:'16px',
            backgroundColor:'#f0fdf4', borderRadius:'8px',
            fontSize:'14px', color:'#166534',
            border:'1px solid #86efac'
          }}>
            <strong>🤖 AI文節認識結果:</strong>{' '}
            {bunsetsuGroups.map((g,i) => (
              <span key={i} style={{
                margin:'0 4px', padding:'2px 8px',
                backgroundColor:'#bbf7d0', borderRadius:'4px',
                fontSize:'13px'
              }}>
                {g.text}
              </span>
            ))}
          </div>
        )}

        {kuromojiStatus === 'error' && (
          <div style={{
            marginTop:'16px', padding:'16px',
            backgroundColor:'#fef2f2', borderRadius:'8px',
            fontSize:'14px', color:'#991b1b',
            border:'1px solid #fecaca'
          }}>
            <strong>⚠️ 注意:</strong> AI文節認識の初期化に失敗しました。文字モードで動作しています。
            <br />
            <small>詳細: 辞書ファイルの読み込みに失敗しました。開発者ツールのコンソールを確認してください。</small>
          </div>
        )}

        {showTranslations && selectedText && (
          <div style={styles.translationContainer}>
            <h3 style={styles.translationTitle}>🌍 翻訳結果</h3>
            <div style={styles.selectedTextBox}>
              <strong>📝 選択テキスト:</strong>{' '}
              <span>{selectedText}</span>
            </div>
            <div style={styles.translationGrid}>
              {targetLanguages.map(lang => (
                <div key={lang.code} style={styles.translationCard}>
                  <div style={styles.flagName}>
                    <span style={styles.flag}>{lang.flag}</span>
                    <span style={styles.langName}>{lang.name}</span>
                  </div>
                  <div style={{
                    ...styles.translatedText,
                    ...(isTranslating ? styles.loadingText : {})
                  }}>
                    {isTranslating
                      ? '🔄 翻訳中…'
                      : translations[lang.code] || '❌ 翻訳エラー'
                    }
                  </div>
                </div>
              ))}
            </div>
            
            {/* 折り返し翻訳ボタン */}
            {!isTranslating && Object.keys(translations).length > 0 && (
              <button 
                onClick={handleBackTranslate} 
                disabled={isBackTranslating}
                style={{
                  ...styles.backTranslateButton,
                  opacity: isBackTranslating ? 0.7 : 1,
                  transform: isBackTranslating ? 'scale(0.95)' : 'scale(1)'
                }}
              >
                {isBackTranslating ? '🔄 折り返し翻訳中…' : '🔁 折り返し翻訳'}
              </button>
            )}
            
            {/* 折り返し翻訳結果 */}
            {showBackTranslations && (
              <div style={styles.backTranslationBox}>
                <h4 style={styles.backTranslationTitle}>
                  🔁 折り返し翻訳結果（各言語→日本語）
                </h4>
                <div style={styles.translationGrid}>
                  {targetLanguages.map(lang => (
                    <div key={lang.code} style={styles.translationCard}>
                      <div style={styles.flagName}>
                        <span style={styles.flag}>{lang.flag}</span>
                        <span style={styles.langName}>{lang.name}→日本語</span>
                      </div>
                      <div style={{
                        ...styles.translatedText,
                        ...(isBackTranslating ? styles.loadingText : {})
                      }}>
                        {isBackTranslating
                          ? '🔄 翻訳中…'
                          : backTranslations[lang.code] || '❌ 翻訳エラー'
                        }
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 再変換結果表示（追加） */}
        {showReconversion && selectedText && (
          <div style={styles.translationContainer}>
            <h3 style={styles.translationTitle}>🔄 再変換候補</h3>
            <div style={styles.selectedTextBox}>
              <strong>📝 現在のテキスト:</strong>{' '}
              <span>{selectedText}</span>
            </div>
            
            <div style={styles.reconversionGrid}>
              {reconversionCandidates.map((candidate, index) => (
                <button
                  key={index}
                  onClick={() => candidate.includes('🔄') || candidate.includes('❌') ? null : applyReconversion(candidate)}
                  disabled={candidate.includes('🔄') || candidate.includes('❌')}
                  style={{
                    ...styles.candidateButton,
                    opacity: candidate.includes('🔄') || candidate.includes('❌') ? 0.6 : 1,
                    cursor: candidate.includes('🔄') || candidate.includes('❌') ? 'default' : 'pointer'
                  }}
                  onMouseEnter={(e) => {
                    if (!candidate.includes('🔄') && !candidate.includes('❌')) {
                      e.target.style.backgroundColor = '#fcd34d';
                      e.target.style.transform = 'translateY(-2px)';
                      e.target.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.15)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!candidate.includes('🔄') && !candidate.includes('❌')) {
                      e.target.style.backgroundColor = '#fef3c7';
                      e.target.style.transform = 'none';
                      e.target.style.boxShadow = 'none';
                    }
                  }}
                >
                  {candidate}
                  {index === 0 && !candidate.includes('🔄') && !candidate.includes('❌') && (
                    <div style={{ fontSize: '12px', color: '#92400e', marginTop: '4px' }}>
                      (元のテキスト)
                    </div>
                  )}
                  {candidate.includes('🔄') && (
                    <div style={{ fontSize: '12px', color: '#92400e', marginTop: '4px' }}>
                      Google APIで候補を生成中...
                    </div>
                  )}
                </button>
              ))}
            </div>
            
            {reconversionCandidates.length === 1 && !reconversionCandidates[0].includes('🔄') && (
              <div style={{ textAlign: 'center', color: '#6b7280', marginTop: '16px' }}>
                他の変換候補が見つかりませんでした
              </div>
            )}
            
            {reconversionCandidates.some(c => c.includes('Google')) && (
              <div style={{ 
                textAlign: 'center', 
                color: '#10b981', 
                marginTop: '16px', 
                fontSize: '14px',
                fontWeight: '500'
              }}>
                ✨ Google翻訳APIによる高精度な変換候補
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ScribbleTranslator;