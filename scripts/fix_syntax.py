files = [
    r'd:\全景项目\常州中级人民法院\Netcatty-Cmdb\build\netcatty-final\components\cmdb\state.js',
    r'd:\全景项目\常州中级人民法院\Netcatty-Cmdb\integrations\netcatty\cmdb\state.js',
    r'd:\全景项目\常州中级人民法院\Netcatty-Cmdb\integrations\netcatty\cmdb\core\state.js',
]

for p in files:
    with open(p, 'r', encoding='utf-8') as f:
        c = f.read()
    c = c.replace('return ${trimmed}庭', "return trimmed + '庭'")
    with open(p, 'w', encoding='utf-8') as f:
        f.write(c)
    print('Fixed in:', p)
