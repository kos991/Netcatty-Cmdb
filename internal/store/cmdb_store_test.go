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
