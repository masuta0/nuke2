// utils/messaging.js
// 共通の自動削除ユーティリティ
// autoDeleteMessage(msg, seconds = 20) をエクスポートします。
// 引数 msg は discord.js の Message オブジェクト（もしくは Promise を返す send()/reply の結果）を想定。
// seconds は削除までの秒数（デフォルト 20）

async function resolveMessage(maybePromise) {
  if (!maybePromise) return null;
  if (typeof maybePromise.then === 'function') {
    try {
      return await maybePromise;
    } catch (e) {
      return null;
    }
  }
  return maybePromise;
}

function autoDeleteMessage(maybeMessage, seconds = 20) {
  // 非同期送信の結果（Promise）を受け取る可能性があるため解決する
  Promise.resolve(resolveMessage(maybeMessage)).then(msg => {
    if (!msg) return;
    try {
      // Message 型であれば delete() を使う
      if (typeof msg.delete === 'function') {
        setTimeout(() => {
          msg.delete().catch(() => {});
        }, Math.max(0, Number(seconds)) * 1000);
        return;
      }
      // interaction の reply を取得して渡すケースでは既に Message が渡るはず
      // その他は無視
    } catch (e) {
      // 念のためエラーは握りつぶす（ログが欲しければここで console.error）
    }
  }).catch(() => {});
}

module.exports = {
  autoDeleteMessage,
};