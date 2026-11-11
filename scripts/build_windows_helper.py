"""Build the public helper download from a release, excluding private files."""
from pathlib import Path
import zipfile

root=Path(__file__).resolve().parents[1]
target=root/'static/assets/dongdongko-windows-helper.zip'
requirements='fastapi>=0.115.0\nuvicorn[standard]>=0.30.0\nnumpy>=1.26.0\nopencv-contrib-python>=4.9.0\nPillow>=10.0.0\npyautogui>=0.9.54\npyperclip>=1.8.2\nmediapipe>=0.10.20,<0.11\n'
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=5) as archive:
    for folder in ('server','static'):
        for path in (root/folder).rglob('*'):
            if not path.is_file() or path.is_symlink():continue
            if '__pycache__' in path.parts or path.suffix.lower() in {'.zip','.pyc','.log','.sqlite3','.db','.env'} or path.name in {'local_secrets.py','.env','.runtime.env'}:continue
            archive.write(path,path.relative_to(root).as_posix())
    archive.writestr('run.py','from server.main import main\nif __name__ == "__main__": main()\n')
    archive.writestr('requirements.txt',requirements)
print('Windows helper:',target.stat().st_size,'bytes')
