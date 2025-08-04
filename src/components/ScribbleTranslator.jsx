import React, { useState, useRef, useCallback, useEffect } from 'react';

// CORS対応の翻訳API
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

const ScribbleTranslator = () => {
  const containerRef = useRef(null);
  const overlayRef = useRef(null);
  const tokenizerRef = useRef(null);

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
  const [bunsetsuGroups, setBunsetsuGroups] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [recognition, setRecognition] = useState(null);
  const [currentText, setCurrentText] = useState(initialText);
  const [isTokenizerReady, setIsTokenizerReady] = useState(false);
  const [isBunsetsuMode, setIsBunsetsuMode] = useState(true);

  const targetLanguages = [
    { code: 'en', name: '英語', flag: '🇺🇸' },
    { code: 'ko', name: '韓国語', flag: '🇰🇷' },
    { code: 'zh', name: '中国語', flag: '🇨🇳' },
  ];

  // Kuromojiトークナイザーの初期化
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
      char, 
      id: `char-${idx}` 
    }));
    setTextChars(chars);
    
    const groups = analyzeBunsetsuWithAI(currentText);
    setBunsetsuGroups(groups);
    
    setSelectedChars(new Set());
    setIsSelectionMode(false);
    setConfirmButtons(null);
    setShowTranslations(false);
  }, [currentText, analyzeBunsetsuWithAI]);

  // 選択文字の更新時に選択テキストを更新
  useEffect(() => {
    if (selectedChars.size > 0) {
      const selectedTextString = Array.from(selectedChars)
        .sort((a, b) => a - b)
        .map(idx => textChars[idx]?.char || '')
        .join('');
      setSelectedText(selectedTextString);
      
      updateConfirmButtonPosition();
    } else {
      setSelectedText('');
      setConfirmButtons(null);
    }
  }, [selectedChars, textChars]);

  // 確認ボタンの位置を計算
  const updateConfirmButtonPosition = () => {
    if (!containerRef.current || selectedChars.size === 0) return;
    
    const overlay = overlayRef.current;
    const spans = containerRef.current.querySelectorAll('.char-span');
    const overlayRect = overlay.getBoundingClientRect();
    const hits = [];
    
    Array.from(selectedChars).forEach(idx => {
      const span = spans[idx];
      if (span) {
        const rect = span.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        hits.push({ cx, cy });
      }
    });
    
    if (hits.length > 0) {
      const xs = hits.map(h => h.cx - overlayRect.left);
      const ys = hits.map(h => h.cy - overlayRect.top);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      setConfirmButtons({ 
        x: (minX + maxX) / 2, 
        y: maxY + 20, 
        count: selectedChars.size 
      });
    }
  };

  // 文節単位での選択
  const toggleBunsetsuSelection = useCallback((groupIndex, e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();
    
    if (!isSelectionMode) {
      setIsSelectionMode(true);
    }
    
    const group = bunsetsuGroups[groupIndex];
    if (!group) return;
    
    const newSelected = new Set(selectedChars);
    const isGroupSelected = group.indices.every(idx => newSelected.has(idx));
    
    if (isGroupSelected) {
      group.indices.forEach(idx => newSelected.delete(idx));
      console.log(`文節 "${group.text}" を選択解除`);
    } else {
      group.indices.forEach(idx => newSelected.add(idx));
      console.log(`文節 "${group.text}" を選択`);
    }
    
    setSelectedChars(newSelected);
    
    if (newSelected.size === 0) {
      setConfirmButtons(null);
      setIsSelectionMode(false);
      setShowTranslations(false);
    }
  }, [selectedChars, isSelectionMode, bunsetsuGroups]);

  // 個別文字のクリックハンドラ
  const toggleCharSelection = useCallback((index, e) => {
    if (!isBunsetsuMode) {
      if (e && e.preventDefault) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
      
      if (!isSelectionMode) {
        setIsSelectionMode(true);
      }
      
      const newSelected = new Set(selectedChars);
      if (newSelected.has(index)) {
        newSelected.delete(index);
      } else {
        newSelected.add(index);
      }
      
      setSelectedChars(newSelected);
      
      if (newSelected.size === 0) {
        setConfirmButtons(null);
        setIsSelectionMode(false);
        setShowTranslations(false);
      }
    } else {
      const groupIndex = bunsetsuGroups.findIndex(group => 
        group.indices.includes(index)
      );
      if (groupIndex !== -1) {
        toggleBunsetsuSelection(groupIndex, e);
      }
    }
  }, [selectedChars, isSelectionMode, bunsetsuGroups, isBunsetsuMode, toggleBunsetsuSelection]);

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
    const selectedIndices = new Set();

    spans.forEach((span, idx) => {
      const rect = span.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      const hit = currentPath.some(p => {
        const absX = p.x + overlayRect.left;
        const absY = p.y + overlayRect.top;
        return Math.hypot(absX - cx, absY - cy) < Math.max(rect.width, rect.height) * 0.7;
      });
      if (hit) {
        if (isBunsetsuMode) {
          const group = bunsetsuGroups.find(g => g.indices.includes(idx));
          if (group) {
            group.indices.forEach(i => selectedIndices.add(i));
          }
        } else {
          selectedIndices.add(idx);
        }
      }
    });

    if (selectedIndices.size > 0) {
      setIsSelectionMode(true);
      setSelectedChars(selectedIndices);
    }

    setCurrentPath([]);
  }, [currentPath, bunsetsuGroups, isBunsetsuMode]);

  const handleTranslate = useCallback(async () => {
    if (!selectedText.trim() || isTranslating) return;

    setIsTranslating(true);
    setShowTranslations(true);

    const results = {};
    for (const lang of targetLanguages) {
      try {
        results[lang.code] = await translateWithMyMemory(selectedText.trim(), lang.code);
        await new Promise(resolve => setTimeout(resolve, 500));
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

  const resetText = () => {
    cancelSelection();
    setCurrentText(initialText);
  };

  const toggleBunsetsuMode = () => {
    setIsBunsetsuMode(prev => !prev);
    cancelSelection();
  };

  const isBunsetsuEnd = (index) => {
    return bunsetsuGroups.some(group => group.end === index);
  };

  const styles = {
    container: {
      width: '100%',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#f8fafc',
      fontFamily: '"Noto Sans JP", system-ui, -apple-system, sans-serif'
    },
    header: {
      background: 'linear-gradient(135deg, #096FCA 0%, #76B7ED 100%)',
      color: 'white',
      padding: '24px 32px',
      boxShadow: '0 4px 20px rgba(9, 111, 202, 0.3)'
    },
    title: {
      fontSize: '32px',
      fontWeight: '700',
      marginBottom: '8px',
      margin: 0,
      textShadow: '0 2px 4px rgba(0,0,0,0.1)'
    },
    subtitle: {
      color: '#E1F5FE',
      fontSize: '16px',
      margin: 0,
      fontWeight: '400'
    },
    toolbar: {
      backgroundColor: 'white',
      padding: '16px 32px',
      borderBottom: '1px solid #e5e7eb',
      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: '16px'
    },
    toolbarInfo: {
      fontSize: '14px',
      color: '#3A3E40',
      flex: 1
    },
    toolbarButtons: {
      display: 'flex',
      gap: '12px',
      alignItems: 'center'
    },
    voiceButton: {
      padding: '8px 16px',
      backgroundColor: isListening ? '#ef4444' : '#3b82f6',
      color: 'white',
      border: 'none',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'all 0.2s',
      boxShadow: isListening ? '0 2px 4px rgba(239, 68, 68, 0.3)' : '0 2px 4px rgba(59, 130, 246, 0.3)',
      display: 'flex',
      alignItems: 'center',
      gap: '6px'
    },
    resetButton: {
      padding: '8px 16px',
      backgroundColor: '#FF7669',
      color: 'white',
      border: 'none',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'all 0.2s',
      boxShadow: '0 2px 4px rgba(255, 118, 105, 0.3)'
    },
    bunsetsuToggle: {
      padding: '8px 16px',
      backgroundColor: isBunsetsuMode ? '#10b981' : '#6b7280',
      color: 'white',
      border: 'none',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'all 0.2s',
      display: 'flex',
      alignItems: 'center',
      gap: '6px'
    },
    main: {
      flex: 1,
      padding: '32px',
      maxWidth: '1200px',
      margin: '0 auto',
      width: '100%'
    },
    textContainer: {
      position: 'relative',
      backgroundColor: 'white',
      padding: '40px',
      borderRadius: '12px',
      boxShadow: '0 8px 25px rgba(0, 0, 0, 0.1)',
      border: '1px solid #e5e7eb',
      marginBottom: '32px'
    },
    textArea: {
      position: 'relative',
      zIndex: 10,
      userSelect: 'none',
      fontSize: '24px',
      lineHeight: '1.8',
      color: '#3A3E40',
      minHeight: '100px'
    },
    charSpan: {
      display: 'inline-block',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      borderRadius: '4px',
      cursor: 'pointer',
      position: 'relative',
      zIndex: isSelectionMode ? 25 : 10,
      pointerEvents: isSelectionMode ? 'auto' : 'none'
    },
    selectedChar: {
      backgroundColor: '#E3F2FD',
      border: '2px solid #096FCA',
      borderRadius: '6px',
      padding: '4px 6px',
      margin: '0 2px',
      transform: 'scale(1.05)',
      boxShadow: '0 2px 8px rgba(9, 111, 202, 0.2)',
      cursor: 'pointer'
    },
    bunsetsuBorder: {
      borderRight: '2px dotted #FF7669',
      paddingRight: '3px',
      marginRight: '3px'
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
      gap: '12px'
    },
    translateButton: {
      padding: '12px 20px',
      backgroundColor: '#10b981',
      color: 'white',
      border: 'none',
      borderRadius: '8px',
      fontSize: '14px',
      fontWeight: '600',
      cursor: 'pointer',
      transition: 'all 0.2s',
      boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    },
    cancelButton: {
      padding: '12px 20px',
      backgroundColor: '#96A0A6',
      color: 'white',
      border: 'none',
      borderRadius: '8px',
      fontSize: '14px',
      fontWeight: '600',
      cursor: 'pointer',
      transition: 'all 0.2s'
    },
    translationContainer: {
      backgroundColor: 'white',
      borderRadius: '12px',
      boxShadow: '0 8px 25px rgba(0, 0, 0, 0.1)',
      border: '1px solid #e5e7eb',
      padding: '32px'
    },
    translationTitle: {
      fontSize: '24px',
      fontWeight: '700',
      color: '#096FCA',
      marginBottom: '20px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    },
    selectedTextBox: {
      backgroundColor: '#F0F8FF',
      padding: '16px',
      borderRadius: '8px',
      border: '1px solid #B3D9FF',
      marginBottom: '24px'
    },
    translationGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: '20px'
    },
    translationCard: {
      backgroundColor: '#FAFBFC',
      padding: '20px',
      borderRadius: '10px',
      border: '1px solid #E5E7EB',
      transition: 'all 0.2s',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)'
    },
    flagName: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      marginBottom: '12px'
    },
    flag: {
      fontSize: '24px'
    },
    langName: {
      fontSize: '16px',
      fontWeight: '600',
      color: '#3A3E40'
    },
    translatedText: {
      color: '#1f2937',
      fontSize: '16px',
      lineHeight: '1.5',
      minHeight: '24px'
    },
    loadingText: {
      color: '#96A0A6',
      fontStyle: 'italic'
    },
    emptyState: {
      textAlign: 'center',
      color: '#96A0A6',
      fontSize: '16px',
      padding: '40px 0'
    },
    aiStatus: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 12px',
      borderRadius: '16px',
      backgroundColor: isTokenizerReady ? '#d1fae5' : '#fee2e2',
      color: isTokenizerReady ? '#065f46' : '#991b1b',
      fontSize: '12px',
      fontWeight: '500'
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>🎨 スクリブル翻訳</h1>
        <p style={styles.subtitle}>AI文節認識で、より自然な文字選択を実現</p>
      </div>
      
      <div style={styles.toolbar}>
        <div style={styles.toolbarInfo}>
          {isListening ? (
            <span style={{ color: '#ef4444', fontWeight: '500' }}>
              🎤 音声入力中... 話してください
            </span>
          ) : selectedChars.size > 0 ? (
            <span style={{ color: '#096FCA', fontWeight: '500' }}>
              ✨ {selectedChars.size}文字選択中: "{selectedText}"
            </span>
          ) : (
            <span>📝 文字数: {textChars.length} | マウスで文字をなぞって選択</span>
          )}
          {isTranslating && (
            <span style={{ color: '#10b981', marginLeft: '16px', fontWeight: '500' }}>
              🔄 翻訳処理中...
            </span>
          )}
          <span style={{ ...styles.aiStatus, marginLeft: '16px' }}>
            {isTokenizerReady ? '🤖 AI文節認識: 有効' : '⏳ AI初期化中...'}
          </span>
        </div>
        <div style={styles.toolbarButtons}>
          <button 
            onClick={toggleBunsetsuMode} 
            style={styles.bunsetsuToggle}
            disabled={!isTokenizerReady}
          >
            {isBunsetsuMode ? '📖 文節モード' : '📝 文字モード'}
          </button>
          <button 
            onClick={toggleVoiceInput} 
            style={styles.voiceButton}
            disabled={!recognition}
          >
            {isListening ? (
              <>⏹️ 音声入力停止</>
            ) : (
              <>🎤 音声入力</>
            )}
          </button>
          <button onClick={resetText} style={styles.resetButton}>
            🔄 リセット
          </button>
        </div>
      </div>

      <div style={styles.main}>
        <div ref={containerRef} style={styles.textContainer}>
          <div style={styles.textArea}>
            {textChars.length > 0 ? (
              textChars.map((c, i) => (
                <span 
                  key={c.id} 
                  className="char-span"
                  onClick={(e) => {
                    toggleCharSelection(i, e);
                  }}
                  style={{
                    ...styles.charSpan,
                    ...(selectedChars.has(i) ? styles.selectedChar : {}),
                    ...(isSelectionMode && !selectedChars.has(i) ? {
                      cursor: 'pointer',
                      padding: '2px 1px'
                    } : {}),
                    ...(isBunsetsuEnd(i) && !isSelectionMode && isBunsetsuMode ? styles.bunsetsuBorder : {})
                  }}
                >
                  {c.char === ' ' ? '\u00A0' : c.char}
                </span>
              ))
            ) : (
              <div style={styles.emptyState}>
                {isListening ? '🎤 話してください...' : '🎤 音声入力ボタンを押して話してください'}
              </div>
            )}
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
              <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                <path
                  d={`M ${currentPath.map(p => `${p.x},${p.y}`).join(' L ')}`}
                  stroke="#096FCA"
                  strokeWidth={4}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.7}
                  filter="drop-shadow(0 2px 4px rgba(9, 111, 202, 0.3))"
                />
              </svg>
            )}
          </div>

          {confirmButtons && selectedChars.size > 0 && (
            <div style={{
              ...styles.buttons,
              left: Math.max(20, confirmButtons.x - 100),
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
              
              <button 
                onClick={cancelSelection} 
                style={styles.cancelButton}
              >
                ✕ キャンセル
              </button>
            </div>
          )}
        </div>

        {isBunsetsuMode && bunsetsuGroups.length > 0 && isTokenizerReady && (
          <div style={{ 
            marginTop: '16px', 
            padding: '16px', 
            backgroundColor: '#f0fdf4', 
            borderRadius: '8px',
            fontSize: '14px',
            color: '#166534',
            border: '1px solid #86efac'
          }}>
            <strong>🤖 AI文節認識結果:</strong> {bunsetsuGroups.map((g, i) => (
              <span key={i} style={{ 
                margin: '0 4px',
                padding: '2px 8px',
                backgroundColor: '#bbf7d0',
                borderRadius: '4px',
                fontSize: '13px'
              }}>
                {g.text}
                {g.features && (
                  <span style={{ fontSize: '11px', color: '#14532d', marginLeft: '4px' }}>
                    ({g.features[0]?.pos})
                  </span>
                )}
              </span>
            ))}
          </div>
        )}

        {showTranslations && selectedText && (
          <div style={styles.translationContainer}>
            <h3 style={styles.translationTitle}>
              🌍 翻訳結果
            </h3>
            <div style={styles.selectedTextBox}>
              <span style={{ fontSize: '14px', fontWeight: '600', color: '#096FCA' }}>
                📝 選択テキスト: 
              </span>
              <span style={{ color: '#3A3E40', fontWeight: '500' }}>{selectedText}</span>
            </div>
            
            <div style={styles.translationGrid}>
              {targetLanguages.map(lang => (
                <div 
                  key={lang.code} 
                  style={styles.translationCard}
                >
                  <div style={styles.flagName}>
                    <span style={styles.flag}>{lang.flag}</span>
                    <span style={styles.langName}>{lang.name}</span>
                  </div>
                  <div style={{
                    ...styles.translatedText,
                    ...(isTranslating ? styles.loadingText : {})
                  }}>
                    {isTranslating ? (
                      '🔄 翻訳中...'
                    ) : (
                      translations[lang.code] || '❌ 翻訳エラー'
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
