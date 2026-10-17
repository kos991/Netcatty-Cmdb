import os

path = r'd:\全景项目\常州中级人民法院\Netcatty-Cmdb\internal\store\legacy_asset_store_test.go'
with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

test_code = """
func TestUpdateAssetAllowsUpdatingOtherFieldsWhenDuplicateOrNonStandardIPExists(t *testing.T) {
	s := newLegacyAssetTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}

	mustLegacyExec(t, s, `INSERT INTO assets (project_id, asset_code, ip, device_type, status) VALUES (1, 'DUP-1', '138.64.7.122', '云桌面终端', '在用')`)
	mustLegacyExec(t, s, `INSERT INTO assets (project_id, asset_code, ip, device_type, status) VALUES (1, 'DUP-2', '138.64.7.122', '云桌面终端', '在用')`)
	mustLegacyExec(t, s, `INSERT INTO assets (project_id, asset_code, ip, device_type, status) VALUES (1, 'WAN-1', '外网', '云桌面终端', '在用')`)
	mustLegacyExec(t, s, `INSERT INTO assets (project_id, asset_code, ip, device_type, status) VALUES (1, 'WAN-2', '外网', '云桌面终端', '在用')`)

	var id1, wan1 int64
	_ = s.db.QueryRow(`SELECT id FROM assets WHERE asset_code='DUP-1'`).Scan(&id1)
	_ = s.db.QueryRow(`SELECT id FROM assets WHERE asset_code='WAN-1'`).Scan(&wan1)

	err = s.UpdateAssetForProject(scope, &Asset{
		ID:         id1,
		AssetCode:  "DUP-1",
		IP:         "138.64.7.122",
		DeviceType: "云桌面终端",
		OSType:     "统信 UOS",
		OSVersion:  "1050u2",
		Status:     "在用",
	}, "测试员")
	if err != nil {
		t.Fatalf("更新同IP历史资产失败: %v", err)
	}

	err = s.UpdateAssetForProject(scope, &Asset{
		ID:         wan1,
		AssetCode:  "WAN-1",
		IP:         "外网",
		DeviceType: "云桌面终端",
		OSType:     "Windows 10",
		Status:     "在用",
	}, "测试员")
	if err != nil {
		t.Fatalf("更新外网IP历史资产失败: %v", err)
	}
}
"""

text = text.rstrip() + "\n" + test_code
with open(path, 'w', encoding='utf-8') as f:
    f.write(text)
print('Test added successfully')
