package store

import (
	"path/filepath"
	"testing"
)

func newPersonTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "person_test.db"))
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestPersonCRUD(t *testing.T) {
	s := newPersonTestStore(t)

	// 1. 创建人员
	p := &Person{
		PersonCode: "EMP001",
		Name:       "张三",
		Department: "信息技术部",
		Title:      "运维主管",
		Phone:      "13800000001",
		Email:      "zhangsan@example.com",
		Status:     "在职",
		Remark:     "核心骨干",
	}
	id, err := s.CreatePerson(p)
	if err != nil {
		t.Fatalf("创建人员失败: %v", err)
	}
	if id <= 0 {
		t.Fatalf("返回的人员 ID 无效: %d", id)
	}

	// 2. 详情获取
	fetched, err := s.GetPerson(id)
	if err != nil {
		t.Fatalf("获取人员详情失败: %v", err)
	}
	if fetched.Name != "张三" || fetched.Department != "信息技术部" {
		t.Fatalf("人员信息不匹配: %+v", fetched)
	}

	// 3. 更新人员
	fetched.Title = "高级运维总监"
	fetched.Status = "调休"
	if err := s.UpdatePerson(fetched); err != nil {
		t.Fatalf("更新人员失败: %v", err)
	}

	updated, err := s.GetPerson(id)
	if err != nil {
		t.Fatalf("重新获取人员失败: %v", err)
	}
	if updated.Title != "高级运维总监" || updated.Status != "调休" {
		t.Fatalf("更新字段未生效: %+v", updated)
	}

	// 4. 列表查询（关键字与部门筛选）
	list, total, err := s.ListPersons(PersonQuery{Keyword: "张三", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("列表查询失败: %v", err)
	}
	if total != 1 || len(list) != 1 {
		t.Fatalf("列表条数不正确: total=%d, len=%d", total, len(list))
	}

	// 5. 删除人员
	if err := s.DeletePerson(id); err != nil {
		t.Fatalf("删除人员失败: %v", err)
	}
	if _, err := s.GetPerson(id); err == nil {
		t.Fatalf("删除后应当无法查出该人员")
	}
}

func TestGetPersonAssets(t *testing.T) {
	s := newPersonTestStore(t)

	// 创建人员
	pID, err := s.CreatePerson(&Person{
		PersonCode: "EMP002",
		Name:       "李四",
		Department: "审判第一庭",
		Status:     "在职",
	})
	if err != nil {
		t.Fatalf("创建人员失败: %v", err)
	}

	// 为李四分配两台资产（一台终端，一台服务器），并带网络接口
	a1ID, err := s.CreateCmdbAssetManual(&CmdbAsset{
		Name:       "李四-办公PC",
		AssetClass: "pc",
		OwnerID:    pID,
		Owner:      "李四",
		Department: "审判第一庭",
		Interfaces: []CmdbAssetInterface{
			{Name: "eth0", IP: "172.16.10.101", MAC: "00:11:22:33:44:55", IsPrimary: 1},
		},
	})
	if err != nil {
		t.Fatalf("创建资产1失败: %v", err)
	}
	if a1ID <= 0 {
		t.Fatalf("资产1 ID 无效")
	}

	a2ID, err := s.CreateCmdbAssetManual(&CmdbAsset{
		Name:       "李四-专案虚拟机",
		AssetClass: "vm",
		OwnerID:    pID,
		Owner:      "李四",
		Department: "审判第一庭",
		Interfaces: []CmdbAssetInterface{
			{Name: "vnet0", IP: "172.16.20.102", IsPrimary: 1},
		},
	})
	if err != nil {
		t.Fatalf("创建资产2失败: %v", err)
	}
	if a2ID <= 0 {
		t.Fatalf("资产2 ID 无效")
	}

	// 穿透获取李四名下资产
	person, assets, err := s.GetPersonAssets(pID)
	if err != nil {
		t.Fatalf("穿透获取人员名下资产失败: %v", err)
	}
	if person.Name != "李四" {
		t.Fatalf("人员姓名不符: %s", person.Name)
	}
	if len(assets) != 2 {
		t.Fatalf("名下资产数量应为 2，实际为 %d", len(assets))
	}
	if len(assets[0].Interfaces) == 0 {
		t.Fatalf("资产未正确携带网络接口")
	}
}

func TestTransferPersonAssets(t *testing.T) {
	s := newPersonTestStore(t)

	// 创建来源人与目标人
	fromID, err := s.CreatePerson(&Person{
		PersonCode: "EMP003",
		Name:       "王五",
		Department: "立案庭",
		Status:     "离职",
	})
	if err != nil {
		t.Fatalf("创建交接发起人失败: %v", err)
	}

	toID, err := s.CreatePerson(&Person{
		PersonCode: "EMP004",
		Name:       "赵六",
		Department: "执行局",
		Status:     "在职",
	})
	if err != nil {
		t.Fatalf("创建交接接收人失败: %v", err)
	}

	// 给王五分配资产
	_, err = s.CreateCmdbAssetManual(&CmdbAsset{
		Name:       "王五原PC",
		AssetClass: "pc",
		OwnerID:    fromID,
		Owner:      "王五",
		Department: "立案庭",
	})
	if err != nil {
		t.Fatalf("创建资产失败: %v", err)
	}

	// 一键交接
	transferred, err := s.TransferPersonAssets(PersonTransferReq{
		FromPersonID: fromID,
		ToPersonID:   toID,
		Remark:       "离职交接给赵六",
	})
	if err != nil {
		t.Fatalf("资产交接失败: %v", err)
	}
	if transferred != 1 {
		t.Fatalf("期望交接 1 条资产，实际 %d", transferred)
	}

	// 校验王五名下资产为 0
	_, fromAssets, err := s.GetPersonAssets(fromID)
	if err != nil {
		t.Fatalf("查询王五资产失败: %v", err)
	}
	if len(fromAssets) != 0 {
		t.Fatalf("交接后王五名下资产应为 0，实际 %d", len(fromAssets))
	}

	// 校验赵六名下资产为 1 且信息已变更为赵六所在部门
	_, toAssets, err := s.GetPersonAssets(toID)
	if err != nil {
		t.Fatalf("查询赵六资产失败: %v", err)
	}
	if len(toAssets) != 1 {
		t.Fatalf("交接后赵六名下资产应为 1，实际 %d", len(toAssets))
	}
	if toAssets[0].Owner != "赵六" || toAssets[0].Department != "执行局" {
		t.Fatalf("资产属性未正确同步为新接收人: %+v", toAssets[0])
	}
}
