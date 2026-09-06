export type UploadJobData = {
  taskId: string;
  wallpaperId?: string;
  wallpaperIds?: string[];
  storageSelection?: { quarkAccountId?: string; baiduAccountId?: string };
  channelAccountId?: string;
};

/** Old batch tasks did not persist their selected accounts; never guess those on replay. */
export function recoverUploadPayload(taskId: string, payload: unknown): UploadJobData | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  const isId = (id: unknown): id is string => typeof id === "string" && id.trim().length > 0;
  if (value.batch === true && value.queuePayloadVersion !== 1) return null;
  const ids = value.batch === true ? value.wallpaperIds : [value.wallpaperId];
  if (!Array.isArray(ids) || !ids.length || !ids.every(isId) || new Set(ids).size !== ids.length) return null;
  let storageSelection: UploadJobData["storageSelection"];
  if (value.storageSelection !== undefined) {
    if (!value.storageSelection || typeof value.storageSelection !== "object" || Array.isArray(value.storageSelection)) return null;
    const selection = value.storageSelection as Record<string, unknown>;
    if ([selection.quarkAccountId, selection.baiduAccountId].some((id) => id !== undefined && !isId(id))) return null;
    storageSelection = { quarkAccountId: selection.quarkAccountId as string | undefined, baiduAccountId: selection.baiduAccountId as string | undefined };
  }
  if (value.channelAccountId !== undefined && !isId(value.channelAccountId)) return null;
  return {
    taskId,
    ...(value.batch === true ? { wallpaperIds: ids } : { wallpaperId: ids[0] }),
    storageSelection,
    channelAccountId: value.channelAccountId as string | undefined,
  };
}

export function recoveryResourceError(ids: string[], resources: Array<{ id: string; status: string; assetPath: string | null; hasStorage: boolean; hasAnalysis: boolean }>): string | null {
  if (resources.length !== ids.length) return "部分资源已删除，需人工确认";
  if (resources.some((item) => item.status === "archived" || item.status === "rejected")) return "资源已下架或被拒绝，未自动重试";
  if (resources.some((item) => item.status === "published" || item.hasStorage || item.hasAnalysis)) return "资源已有处理痕迹，需核对是否已发布，未自动重试";
  if (resources.some((item) => !item.assetPath)) return "原文件缺失，需重新上传";
  return null;
}
