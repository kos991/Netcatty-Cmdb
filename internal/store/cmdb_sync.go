package store

import (
	"strings"
)

// CmdbSyncResult 记录一次旧台账映射的写入结果。
type CmdbSyncResult struct {
	OrgInserted    int `json:"org_inserted"`
	AssetInserted  int `json:"asset_inserted"`
	ServerInserted int `json:"server_inserted"`
	Skipped        int `json:"skipped"`
}

// mapLegacyAssetStatus 旧终端台账状态 → CMDB 状态白名单。
func mapLegacyAssetStatus(s string) string {
	switch strings.TrimSpace(s) {
	case "在用":
		return "在线"
	case "闲置", "仓库备用":
		return "在库"
	case "维修中":
		return "维护中"
	case "待报废", "已报废":
		return "报废"
	default:
		return "在库"
	}
}

// mapLegacyServerStatus 旧物理服务器状态 → CMDB 状态白名单。
func mapLegacyServerStatus(s string) string {
	switch strings.TrimSpace(s) {
	case "运行中":
		return "在线"
	case "已停机":
		return "离线"
	case "维护中":
		return "维护中"
	case "备用":
		return "在库"
	default:
		return "在库"
	}
}

// AllServers 读取全部物理服务器（不分页）。
// 现有 QueryServers 的 pageSize 上限为 500，超过会回退到默认值 20，
// 映射同步需要完整数据，因此这里单独提供无上限读取。
func (s *Store) AllServers() ([]PhysicalServer, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.AllServersForProject(scope)
}

func (s *Store) cmdbOrgNameToID() (map[string]int64, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.cmdbOrgNameToIDForProject(scope)
}

// cmdbAssetExists 判断某个来源记录是否已经映射过（幂等键：source_type + source_id）。
func (s *Store) cmdbAssetExists(sourceType string, sourceID int64) (bool, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return false, err
	}
	return s.cmdbAssetExistsForProject(scope, sourceType, sourceID)
}

// insertCmdbInterface 写入一条资产网络接口记录。
func (s *Store) insertCmdbInterface(assetID, isPrimary int64, ip, netZone, remark string) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.insertCmdbInterfaceForProject(scope, assetID, isPrimary, ip, netZone, remark)
}

// SyncLegacyToCmdb 把现有 assets / servers 单向幂等映射进 cmdb_assets。
// 重复执行不会产生重复数据：写入前按 source_type + source_id 判重。
func (s *Store) SyncLegacyToCmdb() (*CmdbSyncResult, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.SyncLegacyToCmdbForProject(scope)
}
