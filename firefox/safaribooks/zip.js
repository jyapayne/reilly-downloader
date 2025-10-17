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
    const parts = [];
    let offset = 0;

    for (const file of this.files) {
      const headerLength = 30 + file.nameBytes.length;
      const headerBuffer = new ArrayBuffer(headerLength);
      const headerView = new DataView(headerBuffer);

      file.localHeaderOffset = offset;

      headerView.setUint32(0, 0x04034b50, true);
      headerView.setUint16(4, 20, true); // version needed to extract
      headerView.setUint16(6, 0, true); // general purpose flag
      headerView.setUint16(8, 0, true); // compression (store)
      headerView.setUint16(10, 0, true); // mod time
      headerView.setUint16(12, 0, true); // mod date
      headerView.setUint32(14, file.crc, true);
      headerView.setUint32(18, file.data.length, true);
      headerView.setUint32(22, file.data.length, true);
      headerView.setUint16(26, file.nameBytes.length, true);
      headerView.setUint16(28, 0, true); // extra length

      const headerBytes = new Uint8Array(headerBuffer);
      headerBytes.set(file.nameBytes, 30);
      parts.push(headerBytes, file.data);

      offset += headerBytes.length + file.data.length;
    }

    const centralDirectoryOffset = offset;
    let centralDirectorySize = 0;

    for (const file of this.files) {
      const centralLength = 46 + file.nameBytes.length;
      const centralBuffer = new ArrayBuffer(centralLength);
      const centralView = new DataView(centralBuffer);

      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 0x0014, true); // version made by
      centralView.setUint16(6, 20, true); // version needed to extract
      centralView.setUint16(8, 0, true); // general purpose flag
      centralView.setUint16(10, 0, true); // compression
      centralView.setUint16(12, 0, true); // mod time
      centralView.setUint16(14, 0, true); // mod date
      centralView.setUint32(16, file.crc, true);
      centralView.setUint32(20, file.data.length, true);
      centralView.setUint32(24, file.data.length, true);
      centralView.setUint16(28, file.nameBytes.length, true);
      centralView.setUint16(30, 0, true); // extra field length
      centralView.setUint16(32, 0, true); // comment length
      centralView.setUint16(34, 0, true); // disk number start
      centralView.setUint16(36, 0, true); // internal attrs
      centralView.setUint32(38, 0, true); // external attrs
      centralView.setUint32(42, file.localHeaderOffset, true);

      const centralBytes = new Uint8Array(centralBuffer);
      centralBytes.set(file.nameBytes, 46);
      parts.push(centralBytes);
      centralDirectorySize += centralBytes.length;
      offset += centralBytes.length;
    }

    const endBuffer = new ArrayBuffer(22);
    const endView = new DataView(endBuffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true); // number of this disk
    endView.setUint16(6, 0, true); // disk where central directory starts
    endView.setUint16(8, this.files.length, true); // records on this disk
    endView.setUint16(10, this.files.length, true); // total records
    endView.setUint32(12, centralDirectorySize, true);
    endView.setUint32(16, centralDirectoryOffset, true);
    endView.setUint16(20, 0, true); // comment length

    parts.push(new Uint8Array(endBuffer));

    return new Blob(parts, { type: "application/epub+zip" });
  }
}
