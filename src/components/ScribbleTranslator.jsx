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
  const [bunsetsuGroups, setBunsetsuGroups] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [recognition, setRecognition] = useState(null);
  const [currentText, setCurrentText] = useState(initialText);

  const targetLanguages = [
    { code: 'en', name: '英語', flag: '🇺🇸' },
    { code: 'ko', name: '韓国語', flag: '🇰🇷' },
    { code: 'zh', name: '中国語', flag: '🇨🇳' },
  ];

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
        let interimTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
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
      // テキストをクリアするか確認
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

  // より高度な文節分割（形態素解析風）
// より精密な文節分割
  const analyzeBunsetsu = (text) => {
    const groups = [];
    let currentGroup = [];
    let startIndex = 0;
    
    // 品詞パターンを判定
    const isKanji = (char) => /[\u4e00-\u9faf]/.test(char);
    const isHiragana = (char) => /[\u3040-\u309f]/.test(char);
    const isKatakana = (char) => /[\u30a0-\u30ff]/.test(char);
    const isNumber = (char) => /[0-9０-９]/.test(char);
    const isAlphabet = (char) => /[a-zA-Z]/.test(char);
    
    // 助詞リスト（文節の終わりを示す）
    const particles = ['が', 'を', 'に', 'へ', 'と', 'から', 'まで', 'より', 'で', 'の', 'は', 'も', 'や', 'など', 'とか', 'たり', 'だり'];
    const punctuations = ['、', '。', '！', '？', '・', '：', '；', '「', '」', '『', '』'];
    
    let i = 0;
    while (i < text.length) {
      const char = text[i];
      currentGroup.push(i);
      
      // 次の文字で判断
      if (i < text.length - 1) {
        const nextChar = text[i + 1];
        let shouldSplit = false;
        
        // 句読点は必ず区切る
        if (punctuations.includes(char)) {
          shouldSplit = true;
        }
        // 助詞の検出（1文字助詞）
        else if (particles.includes(char) && !isKanji(nextChar)) {
          shouldSplit = true;
        }
        // 「です」「ます」などの丁寧語
        else if (char === 'で' && nextChar === 'す') {
          currentGroup.push(i + 1);
          i++;
          shouldSplit = true;
        }
        else if (char === 'ま' && nextChar === 'す') {
          currentGroup.push(i + 1);
          i++;
          shouldSplit = true;
        }
        // 動詞の活用形を検出
        else if (isKanji(char) && isHiragana(nextChar)) {
          // 動詞の語幹＋活用部分をまとめる
          let j = i + 1;
          while (j < text.length && isHiragana(text[j])) {
            // 助詞が来たら止める
            if (particles.includes(text[j])) {
              break;
            }
            currentGroup.push(j);
            j++;
            
            // 一般的な動詞活用の終わり
            if (j < text.length) {
              const substring = text.substring(i + 1, j + 1);
              if (substring.endsWith('る') || substring.endsWith('た') || 
                  substring.endsWith('て') || substring.endsWith('だ') ||
                  substring.endsWith('い') || substring.endsWith('く') ||
                  substring.endsWith('ない') || substring.endsWith('ません')) {
                shouldSplit = true;
                break;
              }
            }
          }
          i = j - 1;
        }
        // カタカナ語のまとまり
        else if (isKatakana(char)) {
          let j = i + 1;
          while (j < text.length && (isKatakana(text[j]) || text[j] === 'ー')) {
            currentGroup.push(j);
            j++;
          }
          i = j - 1;
          shouldSplit = true;
        }
        // 数字のまとまり
        else if (isNumber(char)) {
          let j = i + 1;
          while (j < text.length && isNumber(text[j])) {
            currentGroup.push(j);
            j++;
          }
          // 単位を含める
          if (j < text.length && '円個本枚台冊人回度％%'.includes(text[j])) {
            currentGroup.push(j);
            j++;
          }
          i = j - 1;
          shouldSplit = true;
        }
        // アルファベットのまとまり
        else if (isAlphabet(char)) {
          let j = i + 1;
          while (j < text.length && isAlphabet(text[j])) {
            currentGroup.push(j);
            j++;
          }
          i = j - 1;
          shouldSplit = true;
        }
        
        // 区切る場合
        if (shouldSplit && currentGroup.length > 0) {
          groups.push({
            indices: [...currentGroup],
            text: text.slice(startIndex, i + 1),
            start: startIndex,
            end: i
          });
          currentGroup = [];
          startIndex = i + 1;
        }
      }
      
      i++;
    }
    
    // 残りの文字をグループに追加
    if (currentGroup.length > 0) {
      groups.push({
        indices: currentGroup,
        text: text.slice(startIndex),
        start: startIndex,
        end: text.length - 1
      });
    }
    
    return groups;
  };

  // currentTextが変更されたらtextCharsを更新
  useEffect(() => {
    const chars = currentText.split('').map((char, idx) => ({ 
      char, 
      id: `char-${idx}` 
    }));
    setTextChars(chars);
    
    // 文節グループを解析
    const groups = analyzeBunsetsu(currentText);
    setBunsetsuGroups(groups);
    console.log('文節グループ:', groups.map(g => g.text));
    
    // 選択をクリア
    setSelectedChars(new Set());
    setIsSelectionMode(false);
    setConfirmButtons(null);
    setShowTranslations(false);
  }, [currentText]);

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

  // 個別文字のクリックハンドラ（選択時は文節単位、解除時は1文字ずつ）
  const toggleCharSelection = useCallback((index, e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();
    
    const newSelected = new Set(selectedChars);
    
    // 既に選択されている文字をクリックした場合は、1文字だけ解除
    if (newSelected.has(index)) {
      newSelected.delete(index);
      console.log(`文字 "${textChars[index]?.char}" を個別に選択解除`);
      
      if (newSelected.size === 0) {
        setConfirmButtons(null);
        setIsSelectionMode(false);
        setShowTranslations(false);
      }
      
      setSelectedChars(newSelected);
      return;
    }
    
    // 選択されていない文字をクリックした場合は、文節単位で選択
    if (!isSelectionMode) {
      setIsSelectionMode(true);
    }
    
    // どの文節グループに属するか確認
    const group = bunsetsuGroups.find(g => g.indices.includes(index));
    
    if (group) {
      // 文節全体を選択
      group.indices.forEach(idx => newSelected.add(idx));
      console.log(`文節 "${group.text}" を選択`);
    } else {
      // 文節に属さない場合は個別選択
      newSelected.add(index);
      console.log(`文字 "${textChars[index]?.char}" を個別に選択`);
    }
    
    setSelectedChars(newSelected);
  }, [selectedChars, isSelectionMode, bunsetsuGroups, textChars]);

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
      if (hit) hits.push(idx);
    });

    // ヒットした文字が属する文節グループを全て選択
    const selectedIndices = new Set();
    hits.forEach(idx => {
      const group = bunsetsuGroups.find(g => g.indices.includes(idx));
      if (group) {
        group.indices.forEach(i => selectedIndices.add(i));
      } else {
        selectedIndices.add(idx);
      }
    });

    if (selectedIndices.size > 0) {
      setIsSelectionMode(true);
      setSelectedChars(selectedIndices);
    }

    setCurrentPath([]);
  }, [currentPath, bunsetsuGroups]);

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
      borderRight: '1px dashed #ccc',
      paddingRight: '2px',
      marginRight: '2px'
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
    }
  };

  // 文字が文節の最後かどうか確認
  const isBunsetsuEnd = (index) => {
    return bunsetsuGroups.some(group => group.end === index);
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>🎨 スクリブル翻訳</h1>
        <p style={styles.subtitle}>文字をなぞって選択、瞬時に多言語翻訳</p>
      </div>
      
      <div style={styles.toolbar}>
        <div style={styles.toolbarInfo}>
          {isListening ? (
            <span style={{ color: '#ef4444', fontWeight: '500' }}>
              🎤 音声入力中... 話してください
            </span>
          ) : selectedChars.size > 0 ? (
            <span style={{ color: '#096FCA', fontWeight: '500' }}>
              ✨ {selectedChars.size}文字選択中: "{selectedText}" | 💡 選択は文節単位・解除は1文字ずつ
            </span>
          ) : (
            <span>📝 文字数: {textChars.length} | マウスで文字をなぞって文節単位で選択</span>
          )}
          {isTranslating && (
            <span style={{ color: '#10b981', marginLeft: '16px', fontWeight: '500' }}>
              🔄 翻訳処理中...
            </span>
          )}
        </div>
        <div style={styles.toolbarButtons}>
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
                    ...(isBunsetsuEnd(i) && !isSelectionMode ? styles.bunsetsuBorder : {})
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

        {/* 文節表示（デバッグ用 - 必要なければ削除可） */}
        {bunsetsuGroups.length > 0 && (
          <div style={{ 
            marginTop: '16px', 
            padding: '16px', 
            backgroundColor: '#f3f4f6', 
            borderRadius: '8px',
            fontSize: '14px',
            color: '#6b7280'
          }}>
            文節分割: {bunsetsuGroups.map((g, i) => (
              <span key={i} style={{ 
                margin: '0 4px',
                padding: '2px 6px',
                backgroundColor: '#e5e7eb',
                borderRadius: '4px'
              }}>
                {g.text}
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
