package store

import (
	"path/filepath"
	"testing"
)

func newCmdbTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "cmdb_store_test.db"))
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func insertCmdbAsset(t *testing.T, s *Store, a CmdbAsset) int64 {
	t.Helper()
	id, err := s.InsertCmdbAsset(&a)
	if err != nil {
		t.Fatalf("插入测试资产失败: %v", err)
	}
	return id
}

func TestQueryCmdbAssetsFiltersAndPaginates(t *testing.T) {
	s := newCmdbTestStore(t)
	insertCmdbAsset(t, s, CmdbAsset{Name: "1U交换机-5141", AssetCode: "ZC202508140001", Status: "在线", CategoryID: 1})
	insertCmdbAsset(t, s, CmdbAsset{Name: "2U交换机-8037", AssetCode: "ZC202508140002", Status: "在线", CategoryID: 1})
	insertCmdbAsset(t, s, CmdbAsset{Name: "1U配线架-7467", AssetCode: "ZC202508140003", Status: "在库", CategoryID: 2})

	list, total, err := s.QueryCmdbAssets(CmdbAssetQuery{Page: 1, PageSize: 2})
	if err != nil {
		t.Fatalf("查询失败: %v", err)
	}
	if total != 3 {
		t.Fatalf("总数应为 3，实际 %d", total)
	}
	if len(list) != 2 {
		t.Fatalf("第一页应返回 2 条，实际 %d", len(list))
	}

	list, total, err = s.QueryCmdbAssets(CmdbAssetQuery{Keyword: "配线架", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("关键词查询失败: %v", err)
	}
	if total != 1 || list[0].Name != "1U配线架-7467" {
		t.Fatalf("关键词过滤结果错误: total=%d list=%+v", total, list)
	}

	list, total, err = s.QueryCmdbAssets(CmdbAssetQuery{CategoryID: 1, Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("分类过滤失败: %v", err)
	}
	if total != 2 {
		t.Fatalf("分类过滤应返回 2 条，实际 %d", total)
	}

	list, _, err = s.QueryCmdbAssets(CmdbAssetQuery{Status: "在库", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("状态过滤失败: %v", err)
	}
	if len(list) != 1 || list[0].Status != "在库" {
		t.Fatalf("状态过滤结果错误: %+v", list)
	}
}

func TestQueryCmdbAssetsSortWhitelistRejectsUnknownField(t *testing.T) {
	s := newCmdbTestStore(t)
	insertCmdbAsset(t, s, CmdbAsset{Name: "A", AssetCode: "ZC1", Status: "在线"})

	// 非白名单字段必须回退到默认排序，而不是拼接进 SQL
	if _, _, err := s.QueryCmdbAssets(CmdbAssetQuery{SortBy: "name; DROP TABLE cmdb_assets", Page: 1, PageSize: 10}); err != nil {
		t.Fatalf("非法排序字段应回退默认排序而非报错: %v", err)
	}
	var cnt int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM cmdb_assets`).Scan(&cnt); err != nil {
		t.Fatalf("表应当仍然存在: %v", err)
	}
	if cnt != 1 {
		t.Fatalf("数据不应被破坏，实际 %d 行", cnt)
	}
}

func TestQueryCmdbAssetsInfrastructureScope(t *testing.T) {
	s := newCmdbTestStore(t)
	result, err := s.db.Exec(`INSERT INTO cmdb_device_categories(name, parent_id, sort_order) VALUES ('交换机', 0, 0)`)
	if err != nil {
		t.Fatalf("插入交换机分类失败: %v", err)
	}
	switchCategoryID, err := result.LastInsertId()
	if err != nil {
		t.Fatalf("读取交换机分类 ID 失败: %v", err)
	}
	result, err = s.db.Exec(`INSERT INTO cmdb_device_categories(name, parent_id, sort_order) VALUES ('云桌面终端', 0, 0)`)
	if err != nil {
		t.Fatalf("插入终端分类失败: %v", err)
	}
	terminalCategoryID, err := result.LastInsertId()
	if err != nil {
		t.Fatalf("读取终端分类 ID 失败: %v", err)
	}
	insertCmdbAsset(t, s, CmdbAsset{Name: "核心交换机", CategoryID: switchCategoryID})
	insertCmdbAsset(t, s, CmdbAsset{Name: "云桌面终端", CategoryID: terminalCategoryID})

	list, total, err := s.QueryCmdbAssets(CmdbAssetQuery{
		ResourceScope: "infrastructure",
		Page:          1,
		PageSize:      20,
	})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(list) != 1 || list[0].CategoryName != "交换机" {
		t.Fatalf("基础设施筛选异常: total=%d list=%+v", total, list)
	}
}

func TestQueryCmdbAssetsInfrastructureScopeIncludesHyperconverged(t *testing.T) {
	s := newCmdbTestStore(t)
	scopeA, scopeB := newCmdbProjectScopes(t, s)
	categoryID, err := s.CreateCmdbTaxonomyForProject(scopeA, "categories", "超融合", 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	want := map[int64]bool{}
	for _, fixture := range []struct {
		deviceType string
		categoryID int64
	}{
		{"超融合", categoryID},
		{"超融合", 0},
		{"hyperconverged", 0},
		{"HCI", 0},
		{"", categoryID},
	} {
		id, err := s.CreateCmdbAssetManualForProject(scopeA, &CmdbAsset{
			Name: "超融合图标验收", AssetClass: "physical", DeviceType: fixture.deviceType, CategoryID: fixture.categoryID,
		})
		if err != nil {
			t.Fatal(err)
		}
		want[id] = true
	}
	// 终端与其他项目的超融合设备不能混入当前项目的基础设施列表。
	if _, err := s.CreateCmdbAssetManualForProject(scopeA, &CmdbAsset{Name: "终端", DeviceType: "台式电脑"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateCmdbAssetManualForProject(scopeB, &CmdbAsset{Name: "其他项目超融合", DeviceType: "hyperconverged"}); err != nil {
		t.Fatal(err)
	}
	query := CmdbAssetQuery{ResourceScope: "infrastructure", Page: 1, PageSize: 20}
	list, total, err := s.QueryCmdbAssetsForProject(scopeA, query)
	if err != nil {
		t.Fatal(err)
	}
	if total != 5 || len(list) != 5 {
		t.Fatalf("超融合设备被漏掉: total=%d list=%+v", total, list)
	}
	for _, asset := range list {
		if !want[asset.ID] || asset.ProjectID != scopeA.ProjectID {
			t.Fatalf("基础设施列表混入无关资产: %+v", asset)
		}
	}
	exported, err := s.AllCmdbAssetsForProject(scopeA, query)
	if err != nil || len(exported) != 5 {
		t.Fatalf("导出与列表筛选范围不一致: len=%d err=%v", len(exported), err)
	}
}

func TestQueryCmdbAssetsCategoryFilterDoesNotORLegacyDeviceType(t *testing.T) {
	s := newCmdbTestStore(t)
	result, err := s.db.Exec(`INSERT INTO cmdb_device_categories(name, parent_id, sort_order) VALUES ('交换机', 0, 0)`)
	if err != nil {
		t.Fatal(err)
	}
	categoryID, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	categoryAssetID := insertCmdbAsset(t, s, CmdbAsset{Name: "分类交换机", CategoryID: categoryID})
	legacyAssetID := insertCmdbAsset(t, s, CmdbAsset{Name: "历史交换机", DeviceType: "switch"})
	insertCmdbAsset(t, s, CmdbAsset{Name: "历史路由器", DeviceType: "router"})
	result, err = s.db.Exec(`INSERT INTO cmdb_device_categories(name, parent_id, sort_order) VALUES ('网络设备', 0, 0)`)
	if err != nil {
		t.Fatal(err)
	}
	networkCategoryID, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	classifiedSwitchID := insertCmdbAsset(t, s, CmdbAsset{Name: "已归类交换机", CategoryID: networkCategoryID, DeviceType: "交换机"})

	query := CmdbAssetQuery{CategoryID: categoryID, DeviceType: "switch", Page: 1, PageSize: 20}
	list, total, err := s.QueryCmdbAssets(query)
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(list) != 1 {
		t.Fatalf("选择分类时必须按 category_id 精确匹配: total=%d list=%+v", total, list)
	}
	if list[0].ID != categoryAssetID {
		t.Fatalf("分类筛选返回了非该分类设备: %+v", list[0])
	}
	exported, err := s.AllCmdbAssets(query)
	if err != nil || len(exported) != 1 || exported[0].ID != categoryAssetID {
		t.Fatalf("导出与列表的精确分类筛选不一致: len=%d err=%v", len(exported), err)
	}

	typeOnly, typeTotal, err := s.QueryCmdbAssets(CmdbAssetQuery{DeviceType: "switch", Page: 1, PageSize: 20})
	if err != nil || typeTotal != 3 || len(typeOnly) != 3 || typeOnly[0].ID != categoryAssetID || typeOnly[1].ID != legacyAssetID || typeOnly[2].ID != classifiedSwitchID {
		t.Fatalf("设备类型筛选应同时返回已分类资产与未分类旧记录: total=%d list=%+v err=%v", typeTotal, typeOnly, err)
	}
	typeExport, err := s.AllCmdbAssets(CmdbAssetQuery{DeviceType: "switch"})
	if err != nil || len(typeExport) != 3 {
		t.Fatalf("设备类型导出应与列表一致: len=%d err=%v", len(typeExport), err)
	}
}

func TestQueryCmdbAssetsUnassignedGroup(t *testing.T) {
	s := newCmdbTestStore(t)
	insertCmdbAsset(t, s, CmdbAsset{Name: "未分组服务器一", DeviceType: "server"})
	insertCmdbAsset(t, s, CmdbAsset{Name: "未分组服务器二", DeviceType: "server"})
	result, err := s.db.Exec(`INSERT INTO cmdb_groups(name, sort_order) VALUES ('已分组设备', 0)`)
	if err != nil {
		t.Fatal(err)
	}
	groupID, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	insertCmdbAsset(t, s, CmdbAsset{Name: "已分组服务器", DeviceType: "server", GroupID: groupID})

	query := CmdbAssetQuery{GroupID: -1, Page: 1, PageSize: 20}
	list, total, err := s.QueryCmdbAssets(query)
	if err != nil {
		t.Fatal(err)
	}
	if total != 2 || len(list) != 2 {
		t.Fatalf("未分组筛选只应返回 group_id 为空或为零的记录: total=%d list=%+v", total, list)
	}
	exported, err := s.AllCmdbAssets(query)
	if err != nil || len(exported) != 2 {
		t.Fatalf("导出与列表的未分组筛选不一致: len=%d err=%v", len(exported), err)
	}
}

func TestCmdbAssetFiltersMatchActualOwnerBrandModelAndNetworkFields(t *testing.T) {
	s := newCmdbTestStore(t)
	managedID := insertCmdbAsset(t, s, CmdbAsset{
		Name: "边界交换机", DeviceType: "switch", Vendor: "华三", Model: "S5560X",
		Owner: "张三", Department: "信息处", Status: "在线",
	})
	if _, err := s.db.Exec(`INSERT INTO cmdb_asset_interfaces(asset_id,name,network_zone,net_zone) VALUES (?, '管理口', '设备管理网', '')`, managedID); err != nil {
		t.Fatal(err)
	}
	unconfiguredID := insertCmdbAsset(t, s, CmdbAsset{
		Name: "未配网络设备", DeviceType: "router", Vendor: "华三", Status: "离线",
	})

	list, total, err := s.QueryCmdbAssets(CmdbAssetQuery{
		Owner: "张三", Department: "信息处", Vendor: "华三", Model: "S5560X",
		NetType: "设备管理网", Page: 1, PageSize: 20,
	})
	if err != nil || total != 1 || len(list) != 1 || list[0].ID != managedID {
		t.Fatalf("负责人、部门、品牌、型号和接口网络筛选必须取交集: total=%d list=%+v err=%v", total, list, err)
	}
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	if err := s.AttachCmdbAssetInterfacesForProject(scope, list); err != nil {
		t.Fatal(err)
	}
	if len(list[0].Interfaces) != 1 || list[0].Interfaces[0].NetworkZone != "设备管理网" {
		t.Fatalf("列表数据应带回真实网络接口区域: %+v", list[0].Interfaces)
	}
	list, total, err = s.QueryCmdbAssets(CmdbAssetQuery{NetType: CmdbAssetUnconfiguredFilter, Page: 1, PageSize: 20})
	if err != nil || total != 1 || len(list) != 1 || list[0].ID != unconfiguredID {
		t.Fatalf("未配置网络筛选未按管理字段和接口字段判断: total=%d list=%+v err=%v", total, list, err)
	}
}

func TestQueryCmdbAssetsLocationMatchesListExportAndUnconfigured(t *testing.T) {
	s := newCmdbTestStore(t)
	roomID := insertCmdbAsset(t, s, CmdbAsset{
		Name: "核心服务器", DeviceType: "server", Room: "东区机房 301", DataCenter: "常州中院数据中心",
	})
	legacyID := insertCmdbAsset(t, s, CmdbAsset{
		Name: "历史存储", DeviceType: "storage", Area: "灾备机房", CabinetPos: "B08",
	})
	emptyID := insertCmdbAsset(t, s, CmdbAsset{Name: "待上架服务器", DeviceType: "server"})

	for _, fixture := range []struct {
		location string
		wantID   int64
	}{
		{location: "东区机房 301", wantID: roomID},
		{location: "常州中院数据中心", wantID: roomID},
		{location: "灾备机房", wantID: legacyID},
		{location: "B08", wantID: legacyID},
		{location: CmdbAssetUnconfiguredFilter, wantID: emptyID},
	} {
		query := CmdbAssetQuery{Location: fixture.location, Page: 1, PageSize: 20}
		list, total, err := s.QueryCmdbAssets(query)
		if err != nil || total != 1 || len(list) != 1 || list[0].ID != fixture.wantID {
			t.Fatalf("位置筛选 %q 错误: total=%d list=%+v err=%v", fixture.location, total, list, err)
		}
		exported, err := s.AllCmdbAssets(query)
		if err != nil || len(exported) != 1 || exported[0].ID != fixture.wantID {
			t.Fatalf("位置筛选 %q 的列表与导出不一致: list=%+v err=%v", fixture.location, exported, err)
		}
	}
}

func TestCmdbAssetLocationSummaryUsesActualLocationFields(t *testing.T) {
	got := CmdbAssetLocationSummary(CmdbAsset{
		Room: "东区机房 301", DataCenter: "常州中院数据中心", Floor: "3 楼",
		CabinetName: "A01", CabinetRow: "2 排", CabinetCol: 3, StartU: 10, HeightU: 2,
	})
	want := "东区机房 301 · 常州中院数据中心 · 3 楼 · A01 · 2 排 / 3 列 · 10U–11U"
	if got != want {
		t.Fatalf("位置摘要错误: got=%q want=%q", got, want)
	}
	if got := CmdbAssetLocationSummary(CmdbAsset{Area: "灾备机房", CabinetPos: "B08", UStart: 20, UHeight: 1}); got != "灾备机房 · B08 · 20U" {
		t.Fatalf("旧位置字段没有兼容: %q", got)
	}
}
