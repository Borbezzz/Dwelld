"""Check embedded dynamic libraries and signing in a built iPhone .app before installation."""
import pathlib
import plistlib
import re
import subprocess
import sys

bundle = pathlib.Path(sys.argv[1]).resolve()
with (bundle / 'Info.plist').open('rb') as file:
    executable = bundle / plistlib.load(file)['CFBundleExecutable']
images = [executable, *bundle.glob('*.dylib')]
for framework in (bundle / 'Frameworks').glob('*.framework'):
    with (framework / 'Info.plist').open('rb') as file:
        images.append(framework / plistlib.load(file)['CFBundleExecutable'])

def output(*args):
    return subprocess.check_output(args, text=True)

def rpaths(image):
    return re.findall(r'cmd LC_RPATH\s+cmdsize \d+\s+path (.*?) \(offset', output('/usr/bin/otool', '-l', str(image)))

for image in images:
    search = rpaths(image) + rpaths(executable)
    for line in output('/usr/bin/otool', '-L', str(image)).splitlines()[1:]:
        dependency = line.strip().split(' ')[0]
        if not dependency.startswith('@rpath/') or pathlib.Path(dependency).name.startswith('libswift'):
            continue  # Platform libraries are supplied by iOS's shared cache.
        suffix = dependency[len('@rpath/'):]
        candidates = [pathlib.Path(p.replace('@executable_path', str(bundle)).replace('@loader_path', str(image.parent))) / suffix for p in search]
        if not any(path.exists() for path in candidates):
            raise SystemExit(f'Unresolved embedded dependency: {image.name} → {dependency}')
subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(bundle)], check=True)
print(f'Verified embedded dependencies and signatures for {len(images)} Mach-O images.')
