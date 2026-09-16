package store

import (
	"path/filepath"
	"testing"
)

func TestSyncLegacyToCmdbIsIdempotent(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "cmdb_sync_test.db"))
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	defer s.Close()

	if _, err := s.CreateAsset(&Asset{
		AssetCode: "ZC-2026-001", UserName: "张三", Department: "立案庭",
		Room: "302", IP: "172.16.7.10", Status: "在用",
	}, "测试"); err != nil {
		t.Fatalf("准备旧资产数据失败: %v", err)
	}
	if _, err := s.CreateServer(&PhysicalServer{
		DeviceName: "CZFY-DB-SRV-01", AssetCode: "SRV-2026-001",
		BizIP: "172.16.7.21", Status: "运行中", Location: "中心机房",
	}, "测试"); err != nil {
		t.Fatalf("准备旧服务器数据失败: %v", err)
	}

	first, err := s.SyncLegacyToCmdb()
	if err != nil {
		t.Fatalf("首次同步失败: %v", err)
	}
	if first.AssetInserted != 1 || first.ServerInserted != 1 {
		t.Fatalf("首次同步应各写入 1 条，实际 %+v", first)
	}

	second, err := s.SyncLegacyToCmdb()
	if err != nil {
		t.Fatalf("二次同步失败: %v", err)
	}
	if second.AssetInserted != 0 || second.ServerInserted != 0 {
		t.Fatalf("二次同步应全部跳过，实际 %+v", second)
	}

	_, total, err := s.QueryCmdbAssets(CmdbAssetQuery{Page: 1, PageSize: 50})
	if err != nil {
		t.Fatalf("查询失败: %v", err)
	}
	if total != 2 {
		t.Fatalf("重复同步不应产生重复数据，实际 %d 条", total)
	}
}
