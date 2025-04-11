const socket = io();

// DOM要素
const readerStatus = document.getElementById('reader-status');
const readerName = document.getElementById('reader-name');
const cardStatus = document.getElementById('card-status');
const lastCardInfo = document.getElementById('last-card-info');
const systemMessages = document.getElementById('system-messages');
const reinitializeBtn = document.getElementById('reinitialize-btn');
const forceReinitializeBtn = document.getElementById('force-reinitialize-btn');
const serviceRestartTip = document.getElementById('service-restart-tip');

// 再初期化ボタンのイベントリスナー
reinitializeBtn.addEventListener('click', () => {
  addSystemMessage('リーダーの手動再初期化をリクエストしています...', 'info');
  socket.emit('manualReinitialize');
  disableButtons(5000);
});

// 強制再初期化ボタンのイベントリスナー
forceReinitializeBtn.addEventListener('click', () => {
  if (confirm('強制リセットを実行しますか？リーダーの完全なリセットが行われます。')) {
    addSystemMessage('リーダーの強制リセットをリクエストしています...', 'warning');
    socket.emit('forceReinitialize');
    disableButtons(8000);
  }
});

// ボタンを一時的に無効化する関数
function disableButtons(duration) {
  reinitializeBtn.disabled = true;
  forceReinitializeBtn.disabled = true;
  setTimeout(() => {
    reinitializeBtn.disabled = false;
    forceReinitializeBtn.disabled = false;
  }, duration);
}

// システムメッセージハンドラ
socket.on('systemMessage', (data) => {
  addSystemMessage(data.message, data.type);
});

// サービス再起動ティップハンドラ
socket.on('serviceRestartTip', (data) => {
  showServiceRestartTip(data.message);
});

// サービス再起動ヒントを表示
function showServiceRestartTip(message) {
  serviceRestartTip.innerHTML = message;
  serviceRestartTip.classList.remove('hidden');
  
  // 閉じるボタンを追加
  const closeButton = document.createElement('button');
  closeButton.className = 'close-button';
  closeButton.innerHTML = '×';
  closeButton.addEventListener('click', () => {
    serviceRestartTip.classList.add('hidden');
  });
  serviceRestartTip.prepend(closeButton);
}

// システムメッセージを追加する関数
function addSystemMessage(message, type = 'info') {
  const messageElement = document.createElement('div');
  messageElement.className = `system-message ${type}`;
  messageElement.textContent = message;
  
  systemMessages.appendChild(messageElement);
  
  // 最大5つのメッセージを表示
  while (systemMessages.children.length > 5) {
    systemMessages.removeChild(systemMessages.children[0]);
  }
  
  // 一定時間後にメッセージをフェードアウト
  setTimeout(() => {
    messageElement.classList.add('fade-out');
    setTimeout(() => {
      if (messageElement.parentNode === systemMessages) {
        systemMessages.removeChild(messageElement);
      }
    }, 1000);
  }, 5000);
}

// ステータス更新イベントのリスナー
socket.on('statusUpdate', (status) => {
  console.log('ステータス更新:', status);
  
  // リーダーステータス更新
  if (status.readerConnected) {
    readerStatus.textContent = '接続中';
    readerStatus.className = 'indicator connected';
    readerName.textContent = status.readerName;
  } else {
    readerStatus.textContent = '未接続';
    readerStatus.className = 'indicator disconnected';
    readerName.textContent = '';
  }
  
  // カードステータス更新
  if (status.cardPresent) {
    cardStatus.textContent = '検出';
    cardStatus.className = 'indicator connected';
  } else {
    cardStatus.textContent = 'なし';
    cardStatus.className = 'indicator disconnected';
  }
  
  // 最後に読み取ったカード情報の更新
  if (status.lastCardInfo) {
    updateCardInfoDisplay(status.lastCardInfo);
  }
});

// カード情報表示を更新する関数
function updateCardInfoDisplay(cardInfo) {
  let cardInfoHTML = '<table>';
  
  cardInfoHTML += `<tr><th>検出時刻</th><td>${cardInfo.timeDetected || '-'}</td></tr>`;
  cardInfoHTML += `<tr><th>カードATR</th><td>${cardInfo.atr || '-'}</td></tr>`;
  
  if (cardInfo.type === 'FeliCa') {
    cardInfoHTML += `<tr><th>カード種別</th><td>FeliCa (Suicaなど)</td></tr>`;
    cardInfoHTML += `<tr><th>IDm</th><td>${cardInfo.idm || '-'}</td></tr>`;
    cardInfoHTML += `<tr><th>PMm</th><td>${cardInfo.pmm || '-'}</td></tr>`;
  } else {
    cardInfoHTML += `<tr><th>カード種別</th><td>${cardInfo.type || 'ISO/IEC 14443 Type A/B'}</td></tr>`;
    cardInfoHTML += `<tr><th>UID</th><td>${cardInfo.uid || '-'}</td></tr>`;
  }
  
  cardInfoHTML += '</table>';
  lastCardInfo.innerHTML = cardInfoHTML;
}

// 接続イベント
socket.on('connect', () => {
  addSystemMessage('サーバーに接続しました', 'success');
});

// 接続エラーハンドリング
socket.on('connect_error', (error) => {
  console.error('接続エラー:', error);
  readerStatus.textContent = 'サーバーに接続できません';
  readerStatus.className = 'indicator disconnected';
  addSystemMessage('サーバーに接続できません', 'error');
});

// 再接続イベント
socket.on('reconnect', (attemptNumber) => {
  addSystemMessage(`サーバーに再接続しました (${attemptNumber}回目の試行)`, 'success');
});

socket.on('reconnect_error', (error) => {
  addSystemMessage('サーバーへの再接続に失敗しました', 'error');
});
