"""Encrypt the optional local model credential to this site's validated TLS key.

Only ciphertext and the public certificate are written. No plaintext key is
printed, passed as a command argument, or included in a release archive.
"""
import base64
from pathlib import Path
import socket
import ssl
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server import config

key = config.QWEN_API_KEY.strip()
if not key or "\n" in key or "\r" in key:
    raise SystemExit("No usable local model credential")
out = ROOT / "artifacts" / "release-20261021"
cert_path = out / "dongdongko-public.cer"
context = ssl.create_default_context()
with socket.create_connection(("dongdongko.fun", 443), timeout=15) as tcp:
    with context.wrap_socket(tcp, server_hostname="dongdongko.fun") as tls:
        cert_path.write_bytes(tls.getpeercert(binary_form=True))
ps = r"""
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($args[0])
$rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPublicKey($cert)
if (-not $rsa) { throw 'Expected RSA TLS certificate' }
$plain = [Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd())
$cipher = $rsa.Encrypt($plain, [System.Security.Cryptography.RSAEncryptionPadding]::OaepSHA256)
[Console]::Out.Write([Convert]::ToBase64String($cipher))
"""
ps_path = out / "encrypt-credential.ps1"
ps_path.write_text(ps, encoding="utf-8")
result = subprocess.run(
    ["powershell.exe", "-NoProfile", "-File", str(ps_path), str(cert_path)],
    input=("QWEN_API_KEY=" + key + "\n").encode(), capture_output=True, check=False,
)
if result.returncode:
    raise SystemExit("Credential encryption failed; no credential written")
cipher = base64.b64decode(result.stdout)
assert len(cipher) == 256
(out / "model-credential.encrypted").write_bytes(cipher)
print("Credential encrypted to validated dongdongko.fun certificate; plaintext not written")
