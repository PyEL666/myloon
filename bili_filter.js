/***********************************************
 * Bili Home Play Filter for Loon / Surge / QX
 * 作用：在 app.bilibili.com / api.bilibili.com 等返回的 JSON 响应中，
 *      过滤掉播放量低于 MIN_PLAY_COUNT 的视频条目（递归查找可能的数组）。
 *
 * 配置项：
 *   MIN_PLAY_COUNT：最小播放量阈值（小于它的会被过滤掉）
 *   PRESERVE_KEYS：如果条目包含某些关键字段（如 is_up_recommend/owner/ugc_type 等），可用于保留逻辑（示例）
 *
 * 注意：
 *  - 只处理可解析为 JSON 的响应（text/json）。如果响应是 protobuf/binary，本脚本会放行原始响应。
 *  - 运行环境：Loon 的 http-response 脚本。使用 $response / $done API。
 ***********************************************/

const MIN_PLAY_COUNT = 5000; // <- 默认阈值：5000（请根据需要改成你想要的值）
const DEBUG = false;         // true 输出调试信息（仅用于本地调试）

/* 辅助：尝试从一个条目对象中读取播放量（返回整数或 null） */
function extractPlayCount(item) {
  if (!item || typeof item !== 'object') return null;
  // 常见位置依次尝试
  const tryPaths = [
    () => (item.stat && (item.stat.play ?? item.stat.view ?? item.stat.playCount ?? item.stat.views)),
    () => (item.play ?? item.play_count ?? item.playCount ?? item.view ?? item.views),
    () => (item.stat && item.stat.view_count),
    () => (item.data && (item.data.play ?? item.data.view)),
    () => (item.archive && item.archive.stat && item.archive.stat.view)
  ];
  for (let fn of tryPaths) {
    try {
      let v = fn();
      if (v === undefined || v === null) continue;
      // 有的字段是字符串数字
      if (typeof v === 'string') {
        v = v.replace(/[^\d]/g, '');
        if (v === '') continue;
      }
      const n = Number(v);
      if (!isNaN(n)) return Math.floor(n);
    } catch (e) {
      continue;
    }
  }
  return null;
}

/* 辅助：判断一个数组是不是“候选视频列表”——数组项多为对象，并且有若干项包含播放量信息 */
function looksLikeVideoArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return false;
  let objCount = 0;
  let playCountHits = 0;
  const sampleN = Math.min(arr.length, 12);
  for (let i = 0; i < sampleN; i++) {
    const it = arr[i];
    if (it && typeof it === 'object') objCount++;
    const p = extractPlayCount(it);
    if (p !== null) playCountHits++;
  }
  // 若对象占多数且有至少1-2个播放量字段命中，则很可能是视频条目数组
  return (objCount / sampleN) > 0.5 && playCountHits >= 1;
}

/* 递归遍历对象，遇到数组时对可能的“视频数组”进行过滤 */
function walkAndFilter(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    // 如果是视频候选数组，进行过滤
    if (looksLikeVideoArray(obj)) {
      if (DEBUG) console.log("[bili_filter] candidate array length:", obj.length);
      const filtered = obj.filter(entry => {
        const play = extractPlayCount(entry);
        if (play === null) return true; // 不确定播放量，保留以免误删
        return play >= MIN_PLAY_COUNT;
      });
      if (DEBUG) {
        console.log("[bili_filter] filtered ->", filtered.length, "items remain (threshold:", MIN_PLAY_COUNT + ")");
      }
      // 继续对过滤后的元素递归处理（防止嵌套数组/对象里还有列表）
      for (let i = 0; i < filtered.length; i++) filtered[i] = walkAndFilter(filtered[i]);
      return filtered;
    } else {
      // 不是视频列表：递归每项
      for (let i = 0; i < obj.length; i++) obj[i] = walkAndFilter(obj[i]);
      return obj;
    }
  } else {
    // 对象：递归其每个属性
    for (let k of Object.keys(obj)) {
      try {
        obj[k] = walkAndFilter(obj[k]);
      } catch (e) {
        // 忽略不能遍历的属性
      }
    }
    return obj;
  }
}

/* 主逻辑入口（Loon/Surge/QuanX http-response 脚本规范） */
(function main() {
  try {
    if (!$response || !$response.body) {
      // 无响应体，直接返回
      $done({});
      return;
    }
    let body = $response.body;

    // 如果是 Buffer / binary（多为 protobuf），Loon 会传入 base64 或 binary；先尝试以 text 解析
    // 检测是否可能是二进制（简单检测：包含不常见的控制字符），如果看起来二进制则放行
    if (typeof body !== 'string') {
      // 如果环境传入 Buffer-like，尝试转成字符串
      try { body = body.toString(); } catch (e) { $done({}); return; }
    }
    // 快速检测是否为 JSON（首尾是 { 或 [ )
    const head = body.trim().slice(0, 1);
    if (head !== '{' && head !== '[') {
      // 不是 JSON 文本（可能是 protobuf/binary），直接放行
      $done({ body: $response.body });
      return;
    }

    let obj;
    try {
      obj = JSON.parse(body);
    } catch (err) {
      // 非标准 JSON：放行原始响应
      if (DEBUG) console.log("[bili_filter] JSON parse failed:", err);
      $done({ body: $response.body });
      return;
    }

    // 对解析好的对象进行递归过滤
    const newObj = walkAndFilter(obj);

    // 如果结构没有变动（和原体一样），仍返回修改后的序列化（保证 header 不变）
    const newBody = JSON.stringify(newObj);

    if (DEBUG) {
      console.log("[bili_filter] original length:", body.length, "new length:", newBody.length);
    }
    $done({ body: newBody });
  } catch (e) {
    // 出错就放行原始响应，避免影响 App 正常使用
    if (DEBUG) console.log("[bili_filter] exception:", e);
    $done({ body: $response.body });
  }
})();
