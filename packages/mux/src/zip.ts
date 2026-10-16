import { crc32, deflateRawSync } from 'node:zlib'

export type ZipEntry = { name: string; data: Buffer | string; modified?: Date }

/**
 * Minimal ZIP writer (deflate, UTF-8 names, no ZIP64). Diagnostics bundles are a few megabytes
 * of text, so this avoids a dependency while staying readable by every unzip tool.
 */
export function createZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith('/') || entry.name.split('/').includes('..'))
      throw new Error(`Invalid zip entry name: ${entry.name}`)
    const name = Buffer.from(entry.name, 'utf8')
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
    const packed = deflateRawSync(raw)
    // Store when deflate does not help; some tiny files grow.
    const stored = packed.length >= raw.length
    const body = stored ? raw : packed
    if (raw.length > 0xfffffffe || offset > 0xfffffffe || entries.length > 0xfffe)
      throw new Error('Diagnostics bundle exceeds the ZIP32 limits.')
    const { time, date } = dosTime(entry.modified ?? new Date())
    const checksum = crc32(raw)
    const method = stored ? 0 : 8

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    chunks.push(local, name, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE((3 << 8) | 20, 4) // made by: Unix, spec 2.0
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38) // regular file, rw-r--r--
    central.writeUInt32LE(offset, 42)
    directory.push(central, name)

    offset += local.length + name.length + body.length
  }
  const size = directory.reduce((total, part) => total + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(size, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, ...directory, end])
}

function dosTime(value: Date): { time: number; date: number } {
  const year = Math.max(1980, value.getUTCFullYear())
  return {
    time: (value.getUTCHours() << 11) | (value.getUTCMinutes() << 5) | (value.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((value.getUTCMonth() + 1) << 5) | value.getUTCDate()
  }
}
