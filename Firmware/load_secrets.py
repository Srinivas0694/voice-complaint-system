# Injects values from secrets.ini as -D build flags so credentials never
# end up in source control.
Import("env")
import configparser, os

path = os.path.join(env["PROJECT_DIR"], "secrets.ini")
if not os.path.exists(path):
    print("!! secrets.ini not found — copy secrets.ini.example and fill it in")
    Return()

cfg = configparser.ConfigParser()
cfg.read(path)
for key, value in cfg["secrets"].items():
    env.Append(CPPDEFINES=[(key.upper(), env.StringifyMacro(value))])
    print(f"   secret injected: {key.upper()}")
