import csv, json, sys, hashlib
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
csv.field_size_limit(100_000_000)
p=Path(sys.argv[1])
with p.open(encoding='utf-8-sig',newline='') as f:
 reader=csv.DictReader(f)
 rows=list(reader)
 if any(None in r or any(v is None for v in r.values()) for r in rows):
  raise ValueError('Malformed CSV record width')
print(json.dumps({'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'headers':reader.fieldnames,'records':rows},ensure_ascii=False))
