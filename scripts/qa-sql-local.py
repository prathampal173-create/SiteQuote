"""Run rollback-only security fixtures against the disposable local Docker DB."""
import json
import os
import subprocess
import time
from pathlib import Path

results = []
db_container = os.environ.get('SITEQUOTE_QA_DB_CONTAINER', 'supabase_db_sitequote')
output_dir = Path(os.environ.get('SITEQUOTE_QA_OUTPUT_DIR', 'qa-evidence/final-audit'))
output_dir.mkdir(parents=True, exist_ok=True)
for fixture in sorted(Path('supabase/tests').glob('*.sql')):
    command = ['docker', 'exec', '-i', db_container, 'psql', '-X',
               '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
    started = time.monotonic()
    result = subprocess.run(command, input=fixture.read_bytes(),
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    log = output_dir / (fixture.stem + '.log')
    log.write_bytes(result.stdout)
    results.append(dict(command=' '.join(command) + ' < ' + str(fixture),
                        exit_code=result.returncode, log=str(log),
                        duration_seconds=round(time.monotonic() - started, 2)))
    print(fixture.name, result.returncode)
(output_dir / 'sql-fixtures.json').write_text(json.dumps(results, indent=2))
raise SystemExit(any(r['exit_code'] for r in results))
