import tkinter.filedialog as fd
files = fd.askopenfilenames()
for f in files:
    print(f)
