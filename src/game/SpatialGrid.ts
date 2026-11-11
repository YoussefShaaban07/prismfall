/** Uniform spatial hash on the XZ plane for fast neighbour queries. */
export class SpatialGrid<T extends { x: number; z: number }> {
  private map = new Map<number, T[]>();
  private free: T[][] = [];
  constructor(public cell: number) {}

  private key(cx: number, cz: number) {
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  clear() {
    for (const arr of this.map.values()) {
      arr.length = 0;
      this.free.push(arr);
    }
    this.map.clear();
  }

  insert(o: T) {
    const k = this.key(Math.floor(o.x / this.cell), Math.floor(o.z / this.cell));
    let a = this.map.get(k);
    if (!a) {
      a = this.free.pop() ?? [];
      this.map.set(k, a);
    }
    a.push(o);
  }

  query(x: number, z: number, r: number, out: T[]): T[] {
    out.length = 0;
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const a = this.map.get(this.key(cx, cz));
        if (a) for (let i = 0; i < a.length; i++) out.push(a[i]);
      }
    }
    return out;
  }
}
