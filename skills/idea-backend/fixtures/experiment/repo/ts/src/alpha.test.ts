import { ProbeItem, probeCore } from './alpha';

export function testProbeCore(): void {
  const item: ProbeItem = { id: 'x', count: 1 };
  console.log(probeCore(item));
}
