package store

import "testing"

func TestListCmdbOrgsSortedAndSeedableFromDepartments(t *testing.T) {
	s := newCmdbTestStore(t)

	inserted, err := s.SeedCmdbOrgsFromDepartments([]string{"立案庭", "执行局", "立案庭"})
	if err != nil {
		t.Fatalf("写入组织失败: %v", err)
	}
	if inserted != 2 {
		t.Fatalf("重复科室只应写入 1 次，期望新增 2 条，实际 %d", inserted)
	}

	// 再次执行必须幂等
	if _, err := s.SeedCmdbOrgsFromDepartments([]string{"立案庭"}); err != nil {
		t.Fatalf("重复写入应当幂等: %v", err)
	}

	orgs, err := s.ListCmdbOrgs()
	if err != nil {
		t.Fatalf("查询组织失败: %v", err)
	}
	if len(orgs) != 2 {
		t.Fatalf("组织数应为 2，实际 %d", len(orgs))
	}
}

func TestCmdbWhitelistsMatchNettopoEvidence(t *testing.T) {
	want := []string{"在线", "在库", "报废", "维护中", "离线", "故障"}
	if len(CmdbAssetStatuses) != len(want) {
		t.Fatalf("状态白名单长度不符: %v", CmdbAssetStatuses)
	}
	for i, v := range want {
		if CmdbAssetStatuses[i] != v {
			t.Fatalf("状态白名单第 %d 项应为 %s，实际 %s", i, v, CmdbAssetStatuses[i])
		}
	}
}
