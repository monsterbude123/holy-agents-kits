import { ProbeItem, ProbeRunner, probeCore } from './alpha';

export function gammaUse(item: ProbeItem): string {
  const runner = new ProbeRunner('g:');
  return runner.run(item) + probeCore(item);
}
