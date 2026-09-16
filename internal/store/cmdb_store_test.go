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
