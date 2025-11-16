/*
  B站首页低播放量过滤器（仅普通首页，不处理 story）
  通过 Loon Argument 获取 minplay（可在插件设置中修改）
*/

let minPlay = parseInt($argument.minplay) || 0;

// 只处理标准 JSON
if (typeof $response.body !== "string") {
  $done({});
}

try {
  let obj = JSON.parse($response.body);

  if (!obj || !obj.data || !obj.data.items) {
    $done({});
    return;
  }

  // 过滤 items
  obj.data.items = obj.data.items.filter(item => {
    if (!item || !item.stat || typeof item.stat.view !== "number") return true;
    return item.stat.view >= minPlay;
  });

  $done({ body: JSON.stringify(obj) });

} catch (e) {
  console.log("BiliFilter Error: " + e);
  $done({});
}