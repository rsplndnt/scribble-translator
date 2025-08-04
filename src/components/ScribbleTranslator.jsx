import React, { useState, useRef, useCallback, useEffect } from 'react';
// CORS対応の翻訳APIです
const translateWithMyMemory = async (text, targetLang) => {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
      text
    )}&langpair=ja|${targetLang}`;
    const response = await fetch(url);
    const data = await response.json();
    return data.responseData.translatedText;
  } catch (error) {
    console.error('Translation error:', error);
    return '翻訳エラー';
  }
};
 main
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    const data = await response.json();
    return data[0][0][0];
  } catch (error) {
    console.error('Translation error:', error);
    return '翻訳エラー';
  }
};

const ScribbleTranslator = () => {
  const containerRef = useRef(null);
  const overlayRef = useRef(null);

  const initialText = 'この文章の文字を選択してから翻訳できます。ぐしゃぐしゃ描いて文字を選択し、翻訳ボタンを押してください。';

  const [textChars, setTextChars] = useState([]);
  const [selectedChars, setSelectedChars] = useState(new Set());
  const [currentPath, setCurrentPath] = useState([]);
  const [confirmButtons, setConfirmButtons] = useState(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [translations, setTranslations] = useState({});
  const [isTranslating, setIsTranslating] = useState(false);
  const [showTranslations, setShowTranslations] = useState(false);
  const [selectedText, setSelectedText] = useState('');

  const targetLanguages = [
    { code: 'en', name: '英語', flag: '🇺🇸' },
    { code: 'ko', name: '韓国語', flag: '🇰🇷' },
    { code: 'zh', name: '中国語', flag: '🇨🇳' },
  ];

  useEffect(() => {
  useEffect(() => {
    const initializeTokenizer = async () => {
      try {
        if (typeof window.kuromoji !== 'undefined') {
          const dicPath = "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/";

          window.kuromoji.builder({ dicPath }).build((err, tokenizer) => {
            if (err) {
              console.error('Kuromoji initialization error:', err);
              setIsBunsetsuMode(false);
              return;
            }
            tokenizerRef.current = tokenizer;
            setIsTokenizerReady(true);
            console.log('形態素解析エンジン初期化完了');
          });
        } else {
          console.warn('Kuromoji not loaded, falling back to simple mode');
          setIsBunsetsuMode(false);
        }
      } catch (error) {
        console.error('Tokenizer initialization failed:', error);
        setIsBunsetsuMode(false);
      }
    };

    initializeTokenizer();
  }, []);

  // AI文節分割（形態素解析ベース）
  const analyzeBunsetsuWithAI = useCallback((text) => {
    if (!tokenizerRef.current || !isBunsetsuMode) {
      return text.split('').map((char, idx) => ({
        indices: [idx],
        text: char,
      }));
    }

    const tokens = tokenizerRef.current.tokenize(text);
    const result = [];
    let index = 0;

    for (const token of tokens) {
      const length = token.surface_form.length;
      result.push({
        indices: Array.from({ length }, (_, i) => index + i),
        text: token.surface_form,
      });
      index += length;
    }

    return result;
  }, [isBunsetsuMode]);

        text: char,
        start: idx,
        end: idx
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
        const tokenLength = token.surface_form.length;
        const tokenIndices = Array.from({ length: tokenLength }, (_, i) => charIndex + i);
        
        const pos = token.pos;
        const features = token.pos_detail_1;
        
        currentGroup.push(token.surface_form);
        currentIndices.push(...tokenIndices);

        let shouldSplit = false;

        if (pos === '助詞' || pos === '助動詞' || 
            token.surface_form.match(/[、。！？]/) ||
            features === '句点' || features === '読点') {
          shouldSplit = true;
        }
        
        if (tokenIndex < tokens.length - 1) {
          const nextToken = tokens[tokenIndex + 1];
          if ((pos === '動詞' || pos === '形容詞') && 
              (nextToken.pos === '助詞' || nextToken.pos === '名詞')) {
            shouldSplit = true;
          }
        }

        if (shouldSplit || tokenIndex === tokens.length - 1) {
          groups.push({
            indices: [...currentIndices],
            text: currentGroup.join(''),
            start: groupStart,
            end: charIndex + tokenLength - 1,
            tokens: [...currentGroup],
            features: tokens.slice(groupStart, tokenIndex + 1).map(t => ({
              surface: t.surface_form,
              pos: t.pos,
              detail: t.pos_detail_1
            }))
          });
          currentGroup = [];
          currentIndices = [];
          groupStart = charIndex + tokenLength;
        }

        charIndex += tokenLength;
      });

      console.log('AI文節分割結果:', groups.map(g => `[${g.text}]`).join(' '));
      return groups;
    } catch (error) {
      console.error('AI文節分割エラー:', error);
      return text.split('').map((char, idx) => ({
        indices: [idx],
        text: char,
        start: idx,
        end: idx
      }));
    }
  }, [isBunsetsuMode]);

  // 音声認識の初期化
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognitionInstance = new SpeechRecognition();
      
      recognitionInstance.lang = 'ja-JP';
      recognitionInstance.interimResults = true;
      recognitionInstance.continuous = true;
      
      recognitionInstance.onresult = (event) => {
        let finalTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          }
        }
        
        if (finalTranscript) {
          setCurrentText(prev => prev + finalTranscript);
        }
      };
      
      recognitionInstance.onerror = (event) => {
        console.error('音声認識エラー:', event.error);
        setIsListening(false);
      };
      
      recognitionInstance.onend = () => {
        setIsListening(false);
      };
      
      setRecognition(recognitionInstance);
    }
  }, []);

  // 音声入力の開始/停止
  const toggleVoiceInput = useCallback(() => {
    if (!recognition) {
      alert('お使いのブラウザは音声認識に対応していません。ChromeまたはEdgeをお使いください。');
      return;
    }
    
    if (isListening) {
      recognition.stop();
      setIsListening(false);
    } else {
      if (currentText !== initialText) {
        const shouldClear = window.confirm('現在のテキストをクリアして音声入力を開始しますか？\n「キャンセル」を選択すると現在のテキストに追加されます。');
        if (shouldClear) {
          setCurrentText('');
        }
      } else {
        setCurrentText('');
      }
      
      recognition.start();
      setIsListening(true);
    }
  }, [recognition, isListening, currentText, initialText]);

  // currentTextが変更されたらtextCharsを更新
  useEffect(() => {
    const chars = currentText.split('').map((char, idx) => ({ 
=======
    const chars = initialText.split('').map((char, idx) => ({ 
main
      char, 
      id: `char-${idx}` 
    }));
    setTextChars(chars);
 main

  const getMousePos = useCallback((e) => {
    if (!overlayRef.current) return { x: 0, y: 0 };
    
    const rect = overlayRef.current.getBoundingClientRect();
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    const clientY = e.touches?.[0]?.clientY ?? e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const startDrawing = useCallback((e) => {
    e.preventDefault();
    setIsSelectionMode(false);
    setSelectedChars(new Set());
    setConfirmButtons(null);
    setShowTranslations(false);
    setCurrentPath([getMousePos(e)]);
  }, [getMousePos]);

  const draw = useCallback((e) => {
    if (!currentPath.length) return;
    e.preventDefault();
    setCurrentPath(prev => [...prev, getMousePos(e)]);
  }, [currentPath, getMousePos]);

  const stopDrawing = useCallback(() => {
    if (!currentPath.length) return setCurrentPath([]);

    const overlay = overlayRef.current;
    const spans = containerRef.current.querySelectorAll('.char-span');
    const overlayRect = overlay.getBoundingClientRect();
    const hits = [];

    spans.forEach((span, idx) => {
      const rect = span.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      const hit = currentPath.some(p => {
        const absX = p.x + overlayRect.left;
        const absY = p.y + overlayRect.top;
        return Math.hypot(absX - cx, absY - cy) < Math.max(rect.width, rect.height) * 0.7;
      });
main
    });

    const selected = new Set(hits.map(h => h.idx));
    if (selected.size) {
      setIsSelectionMode(true);
      const xs = hits.map(h => h.cx - overlayRect.left);
      const ys = hits.map(h => h.cy - overlayRect.top);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      setConfirmButtons({ x: (minX + maxX) / 2, y: maxY + 20, count: selected.size });
      setSelectedChars(selected);
      
      const selectedTextString = Array.from(selected)
        .sort((a, b) => a - b)
        .map(idx => textChars[idx]?.char || '')
        .join('');
      setSelectedText(selectedTextString);
    }

    setCurrentPath([]);
  }, [currentPath, textChars]);

  const handleTranslate = useCallback(async () => {
    if (!selectedText.trim() || isTranslating) return;

    setIsTranslating(true);
    setShowTranslations(true);

    const results = {};
    for (const lang of targetLanguages) {
      try {
        results[lang.code] = await translateWithGoogle(selectedText.trim(), lang.code);
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error) {
        results[lang.code] = '翻訳エラー';
      }
    }
    
    setTranslations(results);
    setIsTranslating(false);
  }, [selectedText, isTranslating, targetLanguages]);

  const cancelSelection = () => {
    setSelectedChars(new Set());
    setIsSelectionMode(false);
    setConfirmButtons(null);
    setShowTranslations(false);
    setSelectedText('');
    setTranslations({});
  };

main
  const styles = {
    container: {
      width: '100%',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#f8fafc',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    },
    header: {
      background: 'linear-gradient(to right, #3b82f6, #2563eb)',
      color: 'white',
      padding: '24px 32px',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
    },
    title: {
      fontSize: '28px',
      fontWeight: 'bold',
      marginBottom: '8px',
      margin: 0
    },
    subtitle: {
      color: '#bfdbfe',
      fontSize: '14px',
      margin: 0
    },
    toolbar: {
      backgroundColor: 'white',
      padding: '16px 32px',
      borderBottom: '1px solid #e5e7eb',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
    },
    main: {
      flex: 1,
      padding: '32px'
    },
    textContainer: {
      position: 'relative',
      maxWidth: '800px',
      margin: '0 auto 32px',
      backgroundColor: 'white',
      padding: '32px',
      borderRadius: '8px',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
      border: '1px solid #e5e7eb'
    },
    textArea: {
      position: 'relative',
      zIndex: 10,
      userSelect: 'none',
      fontSize: '24px',
      lineHeight: '1.6'
    },
    charSpan: {
      display: 'inline-block',
      transition: 'all 0.2s'
    },
    selectedChar: {
      backgroundColor: '#dbeafe',
      border: '2px solid #60a5fa',
      borderRadius: '4px',
      padding: '2px 4px',
      margin: '0 2px',
      transform: 'scale(1.1)'
    },
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 20
    },
    buttons: {
      position: 'absolute',
      zIndex: 30,
      display: 'flex',
      gap: '8px'
    },
    translateButton: {
      padding: '8px 16px',
      backgroundColor: '#10b981',
      color: 'white',
      border: 'none',
      borderRadius: '8px',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'background-color 0.2s'
    },
    cancelButton: {
      padding: '8px 16px',
      backgroundColor: '#f3f4f6',
      color: '#374151',
      border: '1px solid #d1d5db',
      borderRadius: '8px',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'background-color 0.2s'
    },
    translationContainer: {
      maxWidth: '800px',
      margin: '0 auto',
      backgroundColor: 'white',
      borderRadius: '8px',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
      border: '1px solid #e5e7eb',
      padding: '24px'
    },
    translationTitle: {
      fontSize: '18px',
      fontWeight: 'bold',
      color: '#1f2937',
      marginBottom: '16px'
    },
    selectedTextBox: {
      backgroundColor: '#dbeafe',
      padding: '12px',
      borderRadius: '8px',
      border: '1px solid #93c5fd',
      marginBottom: '16px'
    },
    translationGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
      gap: '16px'
    },
    translationCard: {
      backgroundColor: '#f9fafb',
      padding: '16px',
      borderRadius: '8px',
      border: '1px solid #e5e7eb'
    },
    flagName: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginBottom: '8px'
    },
    flag: {
      fontSize: '20px'
    },
    langName: {
      fontSize: '14px',
      fontWeight: '500'
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>スクリブル翻訳アプリ</h1>
        <p style={styles.subtitle}>文字を選択して翻訳しよう</p>
      </div>
      
      <div style={styles.toolbar}>
        <div style={{ fontSize: '14px', color: '#4b5563' }}>
          {selectedChars.size > 0 ? (
            <span style={{ color: '#2563eb' }}>
              {selectedChars.size}文字選択済み: "{selectedText}"
            </span>
          ) : (
            <span>文字数: {textChars.length}</span>
          )}
          {isTranslating && (
            <span style={{ color: '#2563eb', marginLeft: '16px' }}>翻訳中...</span>
          )}
        </div>
      </div>

      <div style={styles.main}>
        <div ref={containerRef} style={styles.textContainer}>
          <div style={styles.textArea}>
            {textChars.map((c, i) => (
              <span 
                key={c.id} 
                className="char-span"
                style={{
                  ...styles.charSpan,
                  ...(selectedChars.has(i) ? styles.selectedChar : {})
                }}
              >
                {c.char === ' ' ? '\u00A0' : c.char}
              </span>
            ))}
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
            onTouchStart={!isSelectionMode ? startDrawing : undefined}
            onTouchMove={!isSelectionMode ? draw : undefined}
            onTouchEnd={!isSelectionMode ? stopDrawing : undefined}
          >
            {currentPath.length > 1 && (
              <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                <path
                  d={`M ${currentPath.map(p => `${p.x},${p.y}`).join(' L ')}`}
                  stroke="#2563eb"
                  strokeWidth={3}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.8}
                />
              </svg>
            )}
          </div>

          {confirmButtons && (
            <div style={{
              ...styles.buttons,
              left: Math.max(20, confirmButtons.x - 80),
              top: confirmButtons.y
            }}>
              <button 
                onClick={handleTranslate} 
                disabled={isTranslating}
                style={{
                  ...styles.translateButton,
                  backgroundColor: isTranslating ? '#9ca3af' : '#10b981'
                }}
              >
                🌐 翻訳({confirmButtons.count})
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
main
        {showTranslations && selectedText && (
          <div style={styles.translationContainer}>
            <h3 style={styles.translationTitle}>翻訳結果</h3>
            <div style={styles.selectedTextBox}>
              <span style={{ fontSize: '14px', fontWeight: '500', color: '#1d4ed8' }}>
                選択テキスト: 
              </span>
              <span style={{ color: '#1f2937' }}>{selectedText}</span>
            </div>
            
            <div style={styles.translationGrid}>
              {targetLanguages.map(lang => (
                <div key={lang.code} style={styles.translationCard}>
                  <div style={styles.flagName}>
                    <span style={styles.flag}>{lang.flag}</span>
                    <span style={styles.langName}>{lang.name}</span>
                  </div>
                  <div style={{ color: '#1f2937' }}>
                    {isTranslating ? (
                      <div style={{ color: '#6b7280' }}>翻訳中...</div>
                    ) : (
                      translations[lang.code] || '翻訳エラー'
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScribbleTranslator;
