import os
Import("env")

lib_path = os.path.join(env.subst("$PROJECT_LIBDEPS_DIR"), env.subst("$PIOENV"), "Adafruit_VL53L0X")
cpp_path = os.path.join(lib_path, "Adafruit_VL53L0X.cpp")

if os.path.isfile(cpp_path):
    with open(cpp_path, "r") as f:
        content = f.read()

    # Relax the product revision check: accept minor >= 1 instead of == 1
    old = """if ((DeviceInfo.ProductRevisionMajor != 1) ||
        (DeviceInfo.ProductRevisionMinor != 1)) {"""
    new = """if ((DeviceInfo.ProductRevisionMajor != 1) ||
        (DeviceInfo.ProductRevisionMinor < 1)) {"""

    if old in content:
        content = content.replace(old, new)
        with open(cpp_path, "w") as f:
            f.write(content)
        print("[patch_vl53l0x] Relaxed product revision check (minor >= 1)")
    else:
        print("[patch_vl53l0x] Pattern not found — library already patched?")
else:
    print(f"[patch_vl53l0x] {cpp_path} not found — skipping")
