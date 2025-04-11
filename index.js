const pcsc = require('pcsclite');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

// Express初期化
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 静的ファイルの提供
app.use(express.static(path.join(__dirname, 'public')));

// ルートへのアクセス時にindex.htmlを返す
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebサーバーをPort 3000で起動
server.listen(3000, () => {
  console.log('サーバーが起動しました: http://localhost:3000');
});

// カード情報を保存する変数
let cardInfo = {
  readerConnected: false,
  readerName: '',
  cardPresent: false,
  lastCardInfo: null
};

// PC/SCインスタンスを格納する変数
let pcscInstance = null;

// アクティブなリーダー
let activeReader = null;

// 再初期化処理中かどうかのフラグ
let isReinitializing = false;
// 再初期化の試行回数
let reinitializeAttempts = 0;
// 最大再試行回数
const MAX_REINIT_ATTEMPTS = 5;
// 再初期化タイマー
let reinitTimer = null;

// PC/SC初期化関数
function initializePcsc() {
  try {
    // 既存のインスタンスがあれば閉じる
    if (pcscInstance) {
      try {
        pcscInstance.close();
        pcscInstance = null;
      } catch (err) {
        console.log('PC/SC終了エラー:', err.message);
      }
    }
    
    // タイマーがあれば解除
    if (reinitTimer) {
      clearTimeout(reinitTimer);
      reinitTimer = null;
    }
    
    // メモリ解放のためにGCを促す
    if (global.gc) {
      try {
        global.gc();
      } catch (e) {
        console.log('GCエラー:', e);
      }
    }
    
    // 新しいインスタンスを作成
    console.log('新しいPC/SCインスタンスを作成しています...');
    pcscInstance = pcsc();
    console.log('PC/SCインターフェースを初期化しました');
    
    // リーダーイベントのリスナー
    pcscInstance.on('reader', handleReaderConnection);
    
    // PC/SCエラーハンドリング
    pcscInstance.on('error', handlePcscError);
    
    // 初期化成功
    reinitializeAttempts = 0;
    return true;
  } catch (err) {
    console.error('PC/SC初期化エラー:', err.message);
    return false;
  }
}

// PC/SCの再初期化関数 (完全リセット)
function reinitializePcsc(forceReset = false) {
  // 既に再初期化中なら新たに開始しない（ただしforceResetの場合は例外）
  if (isReinitializing && !forceReset) {
    console.log('既に再初期化処理中です');
    return;
  }
  
  // 試行回数をチェック
  if (reinitializeAttempts >= MAX_REINIT_ATTEMPTS && !forceReset) {
    console.log(`最大再試行回数(${MAX_REINIT_ATTEMPTS}回)に達しました。手動での対応が必要です。`);
    io.emit('systemMessage', { 
      message: `再初期化に${MAX_REINIT_ATTEMPTS}回失敗しました。スマートカードサービスを手動で再起動してください。`, 
      type: 'error' 
    });
    showServiceRestartTip();
    return;
  }
  
  reinitializeAttempts++;
  isReinitializing = true;
  console.log(`PC/SCインターフェースを再初期化しています...(${reinitializeAttempts}回目)`);
  
  // 状態をリセット
  if (activeReader) {
    try {
      activeReader.close();
    } catch (err) {
      console.log('リーダークローズエラー:', err.message);
    }
    activeReader = null;
  }
  
  // Web UIの状態更新
  cardInfo.readerConnected = false;
  cardInfo.readerName = '';
  cardInfo.cardPresent = false;
  io.emit('statusUpdate', cardInfo);
  io.emit('systemMessage', { 
    message: `リーダーの再接続を試みています...(${reinitializeAttempts}回目)`, 
    type: 'info' 
  });
  
  // タイムアウトを増やしていく（だんだん長く待つ）
  const timeout = Math.min(2000 + (reinitializeAttempts * 1000), 10000);
  
  // 少し待ってから再初期化
  reinitTimer = setTimeout(() => {
    if (initializePcsc()) {
      console.log('PC/SCインターフェースの再初期化に成功しました');
      io.emit('systemMessage', { message: 'リーダーの再初期化に成功しました', type: 'success' });
      isReinitializing = false;
    } else {
      console.log(`PC/SCインターフェースの再初期化に失敗しました。${reinitializeAttempts < MAX_REINIT_ATTEMPTS ? '再試行します...' : '最大試行回数に達しました'}`);
      
      if (reinitializeAttempts < MAX_REINIT_ATTEMPTS) {
        io.emit('systemMessage', { 
          message: `リーダーの再初期化に失敗しました。再試行します (${reinitializeAttempts}/${MAX_REINIT_ATTEMPTS})...`, 
          type: 'error' 
        });
        
        // 次回の再試行
        isReinitializing = false; // 一旦フラグを解除して再度実行できるようにする
        reinitTimer = setTimeout(() => reinitializePcsc(), 3000);
      } else {
        io.emit('systemMessage', { 
          message: '再初期化の最大試行回数に達しました。手動での対応が必要です。', 
          type: 'error' 
        });
        showServiceRestartTip();
        isReinitializing = false;
      }
    }
  }, timeout);
}

// Windows PCでスマートカードサービスを再起動するためのヒントを表示
function showServiceRestartTip() {
  const message = `
    <p><strong>スマートカードサービスの再起動が必要です</strong></p>
    <p>以下の手順を試してください：</p>
    <ol>
      <li>Windows+R キーを押して「services.msc」と入力して実行</li>
      <li>「Smart Card」もしくは「スマートカード」サービスを探す</li>
      <li>右クリックして「再起動」を選択</li>
      <li>その後、このページのリーダー再初期化ボタンを押す</li>
    </ol>
  `;
  io.emit('serviceRestartTip', { message });
}

// 強制再初期化関数（完全なリセット）
function forceReinitialize() {
  console.log('強制再初期化を実行します');
  
  // 実行中のタイマーをクリア
  if (reinitTimer) {
    clearTimeout(reinitTimer);
    reinitTimer = null;
  }
  
  // 状態をリセット
  reinitializeAttempts = 0;
  isReinitializing = false;
  
  // アクティブなリソースをすべて解放
  if (activeReader) {
    try {
      activeReader.close();
    } catch (e) {}
    activeReader = null;
  }
  
  if (pcscInstance) {
    try {
      pcscInstance.close();
    } catch (e) {}
    pcscInstance = null;
  }
  
  // UI状態のリセット
  cardInfo.readerConnected = false;
  cardInfo.readerName = '';
  cardInfo.cardPresent = false;
  io.emit('statusUpdate', cardInfo);
  
  // 強制再初期化メッセージ
  io.emit('systemMessage', { message: 'リーダーを完全にリセットしています...', type: 'warning' });
  
  // 少し待ってから初期化
  setTimeout(() => {
    if (initializePcsc()) {
      io.emit('systemMessage', { message: 'リーダーのリセットに成功しました', type: 'success' });
    } else {
      io.emit('systemMessage', { message: 'リーダーのリセットに失敗しました。PCを再起動する必要があるかもしれません', type: 'error' });
      showServiceRestartTip();
    }
  }, 3000);
}

// リーダー接続ハンドラ
function handleReaderConnection(reader) {
  console.log(`リーダー接続: ${reader.name}`);
  
  activeReader = reader;
  
  // リーダー接続状態を更新
  cardInfo.readerConnected = true;
  cardInfo.readerName = reader.name;
  io.emit('statusUpdate', cardInfo);
  io.emit('systemMessage', { message: 'リーダーを接続しました: ' + reader.name, type: 'success' });

  // リーダーのステータス変更を監視
  reader.on('status', (status) => {
    // ステータスに変更があるか確認
    const changes = reader.state ^ status.state;
    
    if (changes) {
      // カードの有無に変化があった場合
      if ((changes & reader.SCARD_STATE_PRESENT) && (status.state & reader.SCARD_STATE_PRESENT)) {
        // カードが挿入された
        console.log('カードを検出しました！');
        console.log('カードATR:', status.atr.toString('hex'));
        
        // カード存在状態を更新
        cardInfo.cardPresent = true;
        cardInfo.lastCardInfo = {
          detected: true,
          atr: status.atr.toString('hex'),
          timeDetected: new Date().toLocaleString(),
        };
        io.emit('statusUpdate', cardInfo);
        
        // カードに接続
        reader.connect({ share_mode: reader.SCARD_SHARE_SHARED }, (err, protocol) => {
          if (err) {
            console.log('カード接続エラー:', err);
            io.emit('systemMessage', { message: 'カード接続エラー: ' + err.message, type: 'error' });
            return;
          }
          
          console.log('プロトコル:', protocol);
          
          // カードUIDを取得
          const getUidCommand = Buffer.from([0xFF, 0xCA, 0x00, 0x00, 0x00]);
          
          reader.transmit(getUidCommand, 255, protocol, (err, data) => {
            if (err) {
              console.log('UIDの取得に失敗しました:', err);
              tryFelicaCommands();
              return;
            }
            
            console.log('レスポンス:', data.toString('hex'));
            
            // 成功ステータス(90 00)の確認
            if (data.length >= 2 && data[data.length - 2] === 0x90 && data[data.length - 1] === 0x00) {
              const uid = data.slice(0, -2);
              console.log('カードUID:', uid.toString('hex'));
              
              // カード情報を更新
              cardInfo.lastCardInfo.uid = uid.toString('hex');
              cardInfo.lastCardInfo.type = 'ISO/IEC 14443';
              io.emit('statusUpdate', cardInfo);
            }
            
            // FeliCaカード(Suicaなど)のコマンドを試行
            tryFelicaCommands();
          });
          
          function tryFelicaCommands() {
            // FeliCaポーリングコマンド
            const pollingCommand = Buffer.from([0xFF, 0x00, 0x00, 0x00, 0x06, 0x00, 0xFF, 0xFF, 0x01, 0x00, 0x00]);
            
            reader.transmit(pollingCommand, 255, protocol, (err, data) => {
              if (err) {
                console.log('FeliCaポーリングエラー:', err);
                disconnectCard();
                return;
              }
              
              console.log('FeliCaポーリングレスポンス:', data.toString('hex'));
              
              // IDm(8バイト)とPMm(8バイト)を抽出
              if (data.length >= 17) {
                const idm = data.slice(2, 10);
                const pmm = data.slice(10, 18);
                
                console.log('カードIDm:', idm.toString('hex'));
                console.log('カードPMm:', pmm.toString('hex'));
                
                // カード情報を更新
                cardInfo.lastCardInfo.idm = idm.toString('hex');
                cardInfo.lastCardInfo.pmm = pmm.toString('hex');
                cardInfo.lastCardInfo.type = 'FeliCa';
                io.emit('statusUpdate', cardInfo);
              }
              
              disconnectCard();
            });
          }
          
          function disconnectCard() {
            reader.disconnect(reader.SCARD_LEAVE_CARD, (err) => {
              if (err) {
                console.log('切断エラー:', err);
              } else {
                console.log('カード読み取り完了、接続を切断しました');
              }
            });
          }
        });
      } else if ((changes & reader.SCARD_STATE_EMPTY) && (status.state & reader.SCARD_STATE_EMPTY)) {
        // カードが取り外された
        console.log('カードが取り外されました');
        
        // カード存在状態を更新
        cardInfo.cardPresent = false;
        io.emit('statusUpdate', cardInfo);
      }
    }
  });
  
  // リーダーのエラーハンドリング
  reader.on('error', err => {
    console.log(`リーダーエラー: ${err.message}`);
    
    // エラーコードでフィルタリング (0x8010001D = SCARD_E_NO_SERVICE)
    if (err.message.includes('0x8010001d') || 
        err.message.includes('SCARD_E_NO_SERVICE') ||
        err.message.includes('スマートカードリソースマネージャー')) {
      io.emit('systemMessage', { message: 'スマートカードサービスが応答していません。再接続を試みます...', type: 'error' });
      reinitializePcsc();
    } else {
      io.emit('systemMessage', { message: 'リーダーエラー: ' + err.message, type: 'error' });
    }
  });
  
  reader.on('end', () => {
    console.log('リーダーが取り外されました');
    
    // リーダー接続状態を更新
    cardInfo.readerConnected = false;
    cardInfo.readerName = '';
    cardInfo.cardPresent = false;
    activeReader = null;
    io.emit('statusUpdate', cardInfo);
    io.emit('systemMessage', { message: 'リーダーが取り外されました', type: 'warning' });
  });
}

// PC/SCエラーハンドラ
function handlePcscError(err) {
  console.log(`PC/SCエラー: ${err.message}`);
  
  // エラーコードでフィルタリング
  if (err.message.includes('0x8010001d') || 
      err.message.includes('SCARD_E_NO_SERVICE') ||
      err.message.includes('スマートカードリソースマネージャー')) {
    io.emit('systemMessage', { message: 'スマートカードサービスが応答していません。再接続を試みます...', type: 'error' });
    reinitializePcsc();
  } else if (err.message.includes('0x80100023') || err.message.includes('SCARD_E_TIMEOUT')) {
    // タイムアウトエラーの場合
    io.emit('systemMessage', { message: 'スマートカードサービスがタイムアウトしました。再接続を試みます...', type: 'warning' });
    reinitializePcsc();
  } else {
    io.emit('systemMessage', { message: 'PC/SCエラー: ' + err.message, type: 'error' });
  }
}

// ソケット接続のハンドリング
io.on('connection', (socket) => {
  console.log('クライアント接続: ' + socket.id);
  
  // 接続時に現在の状態を送信
  socket.emit('statusUpdate', cardInfo);
  
  // 通常の再初期化
  socket.on('manualReinitialize', () => {
    console.log('クライアントから手動再初期化リクエストを受信');
    io.emit('systemMessage', { message: 'リーダーを手動で再初期化しています...', type: 'info' });
    reinitializePcsc(true); // 強制的に再実行
  });
  
  // 強制的な完全再初期化
  socket.on('forceReinitialize', () => {
    console.log('クライアントから強制再初期化リクエストを受信');
    forceReinitialize();
  });
  
  socket.on('disconnect', () => {
    console.log('クライアント切断: ' + socket.id);
  });
});

// 監視タイマーの設定 - 定期的にリーダーの状態を確認
let watchdogTimer = setInterval(() => {
  // リーダーが接続されているのに activeReader がない場合
  if (cardInfo.readerConnected && !activeReader) {
    console.log('警告: 状態の不整合を検出。再初期化します。');
    cardInfo.readerConnected = false;
    cardInfo.readerName = '';
    cardInfo.cardPresent = false;
    io.emit('statusUpdate', cardInfo);
    io.emit('systemMessage', { message: 'リーダー状態の不整合を検出しました。再初期化します...', type: 'warning' });
    reinitializePcsc();
  }
}, 30000);

// 初期化
initializePcsc();

console.log('カードをかざしてください...');
