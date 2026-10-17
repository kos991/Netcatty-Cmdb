package store

import "testing"

// 基础设施列表范围必须以分类目录的 asset_scope 为准。
// 回归：早期实现只匹配英文 device_type 和少量分类名关键字，导致中文规范类型
// （如“安全设备”）配“下一代防火墙”“网络准入系统”这类分类时整行被漏掉。
func TestQueryCmdbAssetsInfrastructureScopeKeepsChineseDeviceTypes(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	firewallCategory, err := s.CreateCmdbTaxonomyForProject(scope, "categories", "下一代防火墙", 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	nasCategory, err := s.CreateCmdbTaxonomyForProject(scope, "categories", "网络准入系统", 0, 2)
	if err != nil {
		t.Fatal(err)
	}

	want := map[int64]bool{}
	for _, fixture := range []struct {
		name       string
		deviceType string
		categoryID int64
	}{
		{"防火墙", "安全设备", firewallCategory},
		{"准入系统", "安全设备", nasCategory},
		{"物理服务器", "物理服务器", 0},
		{"核心交换机", "交换机", 0},
		{"存储阵列", "存储设备", 0},
		{"超融合一体机", "超融合", 0},
		{"应用虚拟机", "虚拟机", 0},
	} {
		id, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: fixture.name, DeviceType: fixture.deviceType, CategoryID: fixture.categoryID})
		if err != nil {
			t.Fatalf("写入 %s 失败: %v", fixture.name, err)
		}
		want[id] = true
	}
	// 终端分类不进入基础设施列表。
	terminalCategory, err := s.CreateCmdbTaxonomyForProject(scope, "terminal-categories", "云桌面终端", 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "云桌面终端", CategoryID: terminalCategory}); err != nil {
		t.Fatal(err)
	}

	query := CmdbAssetQuery{ResourceScope: "infrastructure", Page: 1, PageSize: 50}
	list, total, err := s.QueryCmdbAssetsForProject(scope, query)
	if err != nil {
		t.Fatal(err)
	}
	if total != len(want) || len(list) != len(want) {
		t.Fatalf("基础设施列表漏掉中文类型设备: total=%d want=%d list=%+v", total, len(want), list)
	}
	for _, asset := range list {
		if !want[asset.ID] {
			t.Fatalf("基础设施列表混入无关资产: %+v", asset)
		}
	}

	// 导出必须与列表使用同一范围，不能只导出一部分。
	exported, err := s.AllCmdbAssetsForProject(scope, query)
	if err != nil || len(exported) != len(want) {
		t.Fatalf("导出与列表筛选范围不一致: len=%d want=%d err=%v", len(exported), len(want), err)
	}
}
