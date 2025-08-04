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
  const [isDrawing, setIsDrawing] = useState(false);

  const targetLanguages = [
    { code: 'en', name: '英語', flag: '🇺🇸' },
    { code: 'ko', name: '韓国語', flag: '🇰🇷' },
    { code: 'zh', name: '中国語', flag: '🇨🇳' },
    { code: 'es', name: 'スペイン語', flag: '🇪🇸' },
    { code: 'fr', name: 'フランス語', flag: '🇫🇷' },
  ];

  useEffect(() => {
    const chars = initialText.split('').map((char, idx) => ({ 
      char, 
      id: `char-${idx}` 
    }));
    setTextChars(chars);
  }, [initialText]);

  // 選択文字の更新時に選択テキストを更新
  useEffect(() => {
    if (selectedChars.size > 0) {
      const selectedTextString = Array.from(selectedChars)
        .sort((a, b) => a - b)
        .map(idx => textChars[idx]?.char || '')
        .join('');
      setSelectedText(selectedTextString);
      
      // 確認ボタンの位置を更新
      updateConfirmButtonPosition();
    } else {
      setSelectedText('');
      setConfirmButtons(null);
    }
  }, [selectedChars, textChars]);

  // 確認ボタンの位置を計算
  const updateConfirmButtonPosition = () => {
    if (!containerRef.current || selectedChars.size === 0) return;
    
    const spans = containerRef.current.querySelectorAll('.char-span');
    const overlayRect = overlayRef.current.getBoundingClientRect();
    const positions = [];
    
    selectedChars.forEach(idx => {
      const span = spans[idx];
      if (span) {
        const rect = span.getBoundingClientRect();
        positions.push({
          x: rect.left + rect.width / 2 - overlayRect.left,
          y: rect.top + rect.height / 2 - overlayRect.top
        });
      }
    });
    
    if (positions.length > 0) {
      const xs = positions.map(p => p.x);
      const ys = positions.map(p => p.y);
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

  // 個別文字のクリックハンドラ（選択/解除）
  const handleCharClick = useCallback((index, e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // ドラッグ中は無視
    if (isDrawing) {
      return;
    }
    
    console.log(`Character ${index} clicked, currently selected: ${selectedChars.has(index)}`);
    
    setSelectedChars(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        // 選択解除
        newSet.delete(index);
        console.log(`Character ${index} deselected`);
      } else {
        // 選択
        newSet.add(index);
        console.log(`Character ${index} selected`);
        setIsSelectionMode(true);
      }
      
      // 選択文字がなくなったら選択モードを解除
      if (newSet.size === 0) {
        setIsSelectionMode(false);
        setShowTranslations(false);
      }
      
      return newSet;
    });
  }, [selectedChars, isDrawing]);

  const getMousePos = useCallback((e) => {
    if (!overlayRef.current) return { x: 0, y: 0 };
    
    const rect = overlayRef.current.getBoundingClientRect();
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    const clientY = e.touches?.[0]?.clientY ?? e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const startDrawing = useCallback((e) => {
    e.preventDefault();
    setIsDrawing(true);
    setIsSelectionMode(false);
    setSelectedChars(new Set());
    setConfirmButtons(null);
    setShowTranslations(false);
    setCurrentPath([getMousePos(e)]);
  }, [getMousePos]);

  const draw = useCallback((e) => {
    if (!isDrawing || !currentPath.length) return;
    e.preventDefault();
    setCurrentPath(prev => [...prev, getMousePos(e)]);
  }, [currentPath, getMousePos, isDrawing]);

  const stopDrawing = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);
    
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
      if (hit) hits.push({ idx, cx, cy });
    });

    const selected = new Set(hits.map(h => h.idx));
    if (selected.size) {
      setIsSelectionMode(true);
      setSelectedChars(selected);
    }

    setCurrentPath([]);
  }, [currentPath, textChars, isDrawing]);

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
    setTextChars(initialText.split('').map((char, idx) => ({ 
      char, 
      id: `char-${idx}` 
    })));
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
      alignItems: 'center'
    },
    toolbarInfo: {
      fontSize: '14px',
      color: '#3A3E40'
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
      zIndex: 20,  // overlayより上に配置
      userSelect: 'none',
      fontSize: '24px',
      lineHeight: '1.8',
      color: '#3A3E40'
    },
    charSpan: {
      display: 'inline-block',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      borderRadius: '4px',
      cursor: 'pointer',
      position: 'relative',
      zIndex: 25,  // 確実にoverlayより上
      padding: '2px 4px'
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
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 10  // textAreaより下に配置
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
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>🎨 スクリブル翻訳</h1>
        <p style={styles.subtitle}>文字をなぞって選択、瞬時に多言語翻訳</p>
      </div>
      
      <div style={styles.toolbar}>
        <div style={styles.toolbarInfo}>
          {selectedChars.size > 0 ? (
            <span style={{ color: '#096FCA', fontWeight: '500' }}>
              ✨ {selectedChars.size}文字選択中: "{selectedText}" | 💡 選択した文字をクリックで解除
            </span>
          ) : (
            <span>📝 文字数: {textChars.length} | マウスで文字をなぞって選択、または個別クリックで選択</span>
          )}
          {isTranslating && (
            <span style={{ color: '#10b981', marginLeft: '16px', fontWeight: '500' }}>
              🔄 翻訳処理中...
            </span>
          )}
        </div>
        <button onClick={resetText} style={styles.resetButton}>
          🔄 リセット
        </button>
      </div>

      <div style={styles.main}>
        <div ref={containerRef} style={styles.textContainer}>
          <div style={styles.textArea}>
            {textChars.map((c, i) => (
              <span 
                key={c.id} 
                className="char-span"
                onClick={(e) => handleCharClick(i, e)}
                onMouseDown={(e) => e.stopPropagation()}
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
