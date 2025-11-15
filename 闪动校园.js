// SkipMitm.js
// 功能：全局 MITM，但跳过 mitmapi.huachenjie.com

const targetHost = "mitmapi.huachenjie.com";

if ($request && $request.hostname === targetHost) {
  // 跳过 MITM
  $done({ mitm: false });
} else {
  // 其他请求正常处理
  $done({});
}
