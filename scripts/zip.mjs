// Store-only ZIP: explicit entries keep credentials and build caches out of downloads.
export function zipFiles(entries) {
  const crc=data=>{let c=0xffffffff;for(const byte of data){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0);}return (c^0xffffffff)>>>0;};
  const chunks=[],central=[];let offset=0;
  for(const {name,data}of entries){if(!/^[\w./-]+$/.test(name)||name.includes('..'))throw Error('Chemin ZIP invalide.');const filename=Buffer.from(name),content=Buffer.from(data),sum=crc(content),local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt32LE(sum,14);local.writeUInt32LE(content.length,18);local.writeUInt32LE(content.length,22);local.writeUInt16LE(filename.length,26);
    chunks.push(local,filename,content);const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800,8);record.writeUInt32LE(sum,16);record.writeUInt32LE(content.length,20);record.writeUInt32LE(content.length,24);record.writeUInt16LE(filename.length,28);record.writeUInt32LE(offset,42);central.push(record,filename);offset+=local.length+filename.length+content.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...chunks,directory,end]);
}
