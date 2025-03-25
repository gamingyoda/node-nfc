const pcsc = require('pcsclite');

// PC/SCインターフェースの初期化
const pcscInstance = pcsc();

console.log('カードリーダーを待っています...');

// リーダーが接続されたときのイベントハンドラ
pcscInstance.on('reader', (reader) => {
  console.log(`リーダー接続: ${reader.name}`);

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
        
        // カードに接続
        reader.connect({ share_mode: reader.SCARD_SHARE_SHARED }, (err, protocol) => {
          if (err) {
            console.log('カード接続エラー:', err);
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
              }
              
              disconnectCard();
            });
          }
          
          function disconnectCard() {
            reader.disconnect(reader.SCARD_LEAVE_CARD, (err) => {
              if (err) console.log('切断エラー:', err);
              else console.log('カード読み取り完了、接続を切断しました');
            });
          }
        });
      } else if ((changes & reader.SCARD_STATE_EMPTY) && (status.state & reader.SCARD_STATE_EMPTY)) {
        // カードが取り外された
        console.log('カードが取り外されました');
      }
    }
  });
  
  // リーダーのエラーハンドリング
  reader.on('error', err => {
    console.log(`リーダーエラー: ${err.message}`);
  });
  
  reader.on('end', () => {
    console.log('リーダーが取り外されました');
  });
});

// PC/SCエラーハンドリング
pcscInstance.on('error', err => {
  console.log(`PC/SCエラー: ${err.message}`);
});

console.log('カードをかざしてください...');
