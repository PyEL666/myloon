/***********************************************
 * Bili Home Play Filter (Loon)
 * 支持：
 *   - JSON 响应解析
 *   - 递归查找视频数组
 *   - 播放量过滤
 *   - 插件参数（minPlay / enableFilter）
 ***********************************************/

// 从 Loon 插件传入参数
const MIN_PLAY_COUNT = Number($argument.minPlay) || 0;
const ENABLE_FILTER = ($argument.enableFilter === "true" || $argument.enableFilter === true);

// 是否输出调试日志（建议保持 false）
const DEBUG = false;

/**
 * 提取单个条目的播放量
 */
function extractPlayCount(item) {
  if (!item || typeof item !== "object") return null;

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

      if (typeof v === "string") {
        v = v.replace(/[^\d]/g, "");
        if (v === "") continue;
      }

      const n = Number(v);
      if (!isNaN(n)) return Math.floor(n);
    } catch (e) {
      continue;
    }
  }

  return null;
}

/**
 * 判断数组是否可能是“视频列表”
 */
function looksLikeVideoArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return false;

  let objCount = 0;
  let playCountHits = 0;
  const sampleN = Math.min(arr.length, 12);

  for (let i = 0; i < sampleN; i++) {
    const it = arr[i];
    if (it && typeof it === "object") objCount++;
    const p = extractPlayCount(it);
    if (p !== null) playCountHits++;
  }

  return (objCount / sampleN) > 0.5 && playCountHits >= 1;
}

/**
 * 递归过滤对象结构
 */
function walkAndFilter(obj) {
  if (!obj || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    // 是数组，可能是视频数组
    if (looksLikeVideoArray(obj) && ENABLE_FILTER) {
      if (DEBUG) console.log("[bili_filter] array len:", obj.length);

      const filtered = obj.filter(entry => {
        const play = extractPlayCount(entry);
        if (play === null) return true; // 无播放量字段 → 保留
        return play >= MIN_PLAY_COUNT;
      });

      if (DEBUG) console.log("[bili_filter] → filtered:", filtered.length);

      for (let i = 0; i < filtered.length; i++) {
        filtered[i] = walkAndFilter(filtered[i]);
      }

      return filtered;
    } else {
      for (let i = 0; i < obj.length; i++) {
        obj[i] = walkAndFilter(obj[i]);
      }
      return obj;
    }
  }

  // 普通对象，继续递归
  for (let k of Object.keys(obj)) {
    try {
      obj[k] = walkAndFilter(obj[k]);
    } catch (e) {}
  }

  return obj;
}

/**
 * 主处理逻辑
 */
(function main() {
  try {
    if (!$response || !$response.body) {
      $done({});
      return;
    }

    let body = $response.body;
    if (typeof body !== "string") {
      try { body = body.toString(); }
      catch (e) { $done({}); return; }
    }

    const head = body.trim().slice(0, 1);
    if (head !== "{" && head !== "[") {
      $done({ body: $response.body });
      return;
    }

    let obj;
    try { obj = JSON.parse(body); }
    catch (err) {
      if (DEBUG) console.log("[bili_filter] JSON parse fail");
      $done({ body: $response.body });
      return;
    }

    const newObj = walkAndFilter(obj);
    const newBody = JSON.stringify(newObj);

    $done({ body: newBody });
  } catch (e) {
    if (DEBUG) console.log("[bili_filter] exception:", e);
    $done({ body: $response.body });
  }
})();