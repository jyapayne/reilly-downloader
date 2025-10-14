const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const textEncoder = new TextEncoder();

export class SimpleZip {
  constructor() {
    this.files = [];
  }

  addFile(path, data) {
    if (!(data instanceof Uint8Array)) {
      throw new TypeError(`File data for ${path} must be a Uint8Array.`);
    }
    const cleanPath = path.replace(/\\/g, "/");
    const nameBytes = textEncoder.encode(cleanPath);
    const checksum = crc32(data);
    this.files.push({
      name: cleanPath,
      nameBytes,
      data,
      crc: checksum,
      localHeaderOffset: 0
    });
  }

  generate() {
    let size = 0;
    for (const file of this.files) {
      const localSize = 30 + file.nameBytes.length + file.data.length;
      size += localSize;
    }

    const centralDirectoryOffset = size;
    let centralDirectorySize = 0;
    for (const file of this.files) {
      centralDirectorySize += 46 + file.nameBytes.length;
    }
    size += centralDirectorySize + 22;

    const output = new Uint8Array(size);
    const view = new DataView(output.buffer);
    let offset = 0;

    for (const file of this.files) {
      file.localHeaderOffset = offset;
      view.setUint32(offset, 0x04034b50, true);
      offset += 4;
      view.setUint16(offset, 20, true); // version needed to extract
      offset += 2;
      view.setUint16(offset, 0, true); // general purpose flag
      offset += 2;
      view.setUint16(offset, 0, true); // compression (store)
      offset += 2;
      view.setUint16(offset, 0, true); // mod time
      offset += 2;
      view.setUint16(offset, 0, true); // mod date
      offset += 2;
      view.setUint32(offset, file.crc, true);
      offset += 4;
      view.setUint32(offset, file.data.length, true);
      offset += 4;
      view.setUint32(offset, file.data.length, true);
      offset += 4;
      view.setUint16(offset, file.nameBytes.length, true);
      offset += 2;
      view.setUint16(offset, 0, true); // extra length
      offset += 2;
      output.set(file.nameBytes, offset);
      offset += file.nameBytes.length;
      output.set(file.data, offset);
      offset += file.data.length;
    }

    let centralOffset = centralDirectoryOffset;
    for (const file of this.files) {
      view.setUint32(centralOffset, 0x02014b50, true);
      centralOffset += 4;
      view.setUint16(centralOffset, 0x0014, true); // version made by
      centralOffset += 2;
      view.setUint16(centralOffset, 20, true); // version needed to extract
      centralOffset += 2;
      view.setUint16(centralOffset, 0, true); // general purpose flag
      centralOffset += 2;
      view.setUint16(centralOffset, 0, true); // compression
      centralOffset += 2;
      view.setUint16(centralOffset, 0, true); // mod time
      centralOffset += 2;
      view.setUint16(centralOffset, 0, true); // mod date
      centralOffset += 2;
      view.setUint32(centralOffset, file.crc, true);
      centralOffset += 4;
      view.setUint32(centralOffset, file.data.length, true);
      centralOffset += 4;
      view.setUint32(centralOffset, file.data.length, true);
      centralOffset += 4;
      view.setUint16(centralOffset, file.nameBytes.length, true);
      centralOffset += 2;
      view.setUint16(centralOffset, 0, true); // extra field length
      centralOffset += 2;
      view.setUint16(centralOffset, 0, true); // comment length
      centralOffset += 2;
      view.setUint16(centralOffset, 0, true); // disk number start
      centralOffset += 2;
      view.setUint16(centralOffset, 0, true); // internal file attrs
      centralOffset += 2;
      view.setUint32(centralOffset, 0, true); // external file attrs
      centralOffset += 4;
      view.setUint32(centralOffset, file.localHeaderOffset, true);
      centralOffset += 4;
      output.set(file.nameBytes, centralOffset);
      centralOffset += file.nameBytes.length;
    }

    view.setUint32(centralOffset, 0x06054b50, true);
    centralOffset += 4;
    view.setUint16(centralOffset, 0, true); // number of this disk
    centralOffset += 2;
    view.setUint16(centralOffset, 0, true); // disk where central directory starts
    centralOffset += 2;
    view.setUint16(centralOffset, this.files.length, true); // records on this disk
    centralOffset += 2;
    view.setUint16(centralOffset, this.files.length, true); // total records
    centralOffset += 2;
    view.setUint32(centralOffset, centralDirectorySize, true);
    centralOffset += 4;
    view.setUint32(centralOffset, centralDirectoryOffset, true);
    centralOffset += 4;
    view.setUint16(centralOffset, 0, true); // comment length

    return output;
  }
}
