/** 探针：跨文件被引用的函数与类 */
export interface ProbeItem {
  id: string;
  count: number;
}

/** 被 beta/gamma 引用的核心函数 */
export function probeCore(item: ProbeItem): string {
  return `${item.id}:${item.count}`;
}

/** 被 gamma 引用的类 */
export class ProbeRunner {
  constructor(private readonly prefix: string) {}

  run(item: ProbeItem): string {
    return this.prefix + probeCore(item);
  }
}
