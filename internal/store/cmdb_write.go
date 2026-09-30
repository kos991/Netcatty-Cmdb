package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// ============================ CMDB 资产写操作 ============================
//
// 设计要点：
//  1. cmdb_assets 里有 source_type/source_id 的记录是「由旧台账单向映射而来」。
//     对本模块做批量编辑时，除了改 CMDB 记录本身，还要把**可映射字段反向写穿回源表**
//     （assets / servers），避免「CMDB 改了、台账没改」的两边分叉。
//  2. 无对应关系的纯 CMDB 字段（所属组织 / 分组 / 类别 / 数据中心 / 楼层 / 机柜）只写 CMDB。
//  3. 映射来的记录**不允许删除**——删除后下次同步会重新出现，属于无效操作；
//     应改为「归档」（状态置报废）或在源台账中注销。
//  4. 多网卡接口在保存（新增或更新）时，若 ip_pool 存在该 IP 且为空闲，自动更新为已分配并绑定资产和接口；
//     资产删除或解绑网卡时自动释放回 IP 池。

// CmdbAssetChanges 用指针区分「未提供」与「置为空」。
type CmdbAssetChanges struct {
	Name         *string                 `json:"name"`
	DeviceType   *string                 `json:"device_type"`
	Status       *string                 `json:"status"`
	OrgID        *int64                  `json:"org_id"`
	GroupID      *int64                  `json:"group_id"`
	CategoryID   *int64                  `json:"category_id"`
	Department   *string                 `json:"department"`
	Owner        *string                 `json:"owner"`
	OwnerID      *int64                  `json:"owner_id"`
	DataCenter   *string                 `json:"data_center"`
	Floor        *string                 `json:"floor"`
	CabinetName  *string                 `json:"cabinet_name"`
	Remark       *string                 `json:"remark"`
	CustomFields *map[string]interface{} `json:"custom_fields"`
}

// 列名全部为字面量，不接受外部输入，杜绝注入。
func (c CmdbAssetChanges) build() (string, []interface{}, error) {
	var sets []string
	var args []interface{}
	add := func(col string, val interface{}) {
		sets = append(sets, col+" = ?")
		args = append(args, val)
	}
	if c.Name != nil {
		add("name", *c.Name)
	}
	if c.DeviceType != nil {
		add("device_type", *c.DeviceType)
	}
	if c.Status != nil {
		add("status", *c.Status)
	}
	if c.OrgID != nil {
		add("org_id", *c.OrgID)
	}
	if c.GroupID != nil {
		add("group_id", *c.GroupID)
	}
	if c.CategoryID != nil {
		add("category_id", *c.CategoryID)
	}
	if c.Department != nil {
		add("department", *c.Department)
	}
	if c.Owner != nil {
		add("owner", *c.Owner)
	}
	if c.OwnerID != nil {
		add("owner_id", *c.OwnerID)
	}
	if c.DataCenter != nil {
		add("data_center", *c.DataCenter)
	}
	if c.Floor != nil {
		add("floor", *c.Floor)
	}
	if c.CabinetName != nil {
		add("cabinet_name", *c.CabinetName)
	}
	if c.Remark != nil {
		add("remark", *c.Remark)
	}
	if c.CustomFields != nil {
		encoded, err := json.Marshal(*c.CustomFields)
		if err != nil {
			return "", nil, fmt.Errorf("自定义字段序列化失败: %w", err)
		}
		add("custom_fields", string(encoded))
	}
	return strings.Join(sets, ", "), args, nil
}

func (c CmdbAssetChanges) isEmpty() bool {
	return c.Name == nil && c.DeviceType == nil && c.Status == nil && c.OrgID == nil &&
		c.GroupID == nil && c.CategoryID == nil && c.Department == nil && c.Owner == nil &&
		c.OwnerID == nil && c.DataCenter == nil && c.Floor == nil && c.CabinetName == nil &&
		c.Remark == nil && c.CustomFields == nil
}

// CMDB 状态 → 旧终端台账状态
func cmdbStatusToLegacyAsset(s string) string {
	switch strings.TrimSpace(s) {
	case "在线":
		return "在用"
	case "在库":
		return "闲置"
	case "维护中":
		return "维修中"
	case "报废":
		return "已报废"
	default:
		return s
	}
}

// CMDB 状态 → 旧服务器状态
func cmdbStatusToLegacyServer(s string) string {
	switch strings.TrimSpace(s) {
	case "在线":
		return "运行中"
	case "离线":
		return "已停机"
	case "在库":
		return "备用"
	default:
		return s
	}
}

func verifyLegacyWrite(asset *CmdbAsset, result sql.Result, err error) error {
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return fmt.Errorf("来源记录 %s/%d 不存在", asset.SourceType, asset.SourceID)
	}
	return nil
}

// writeThroughToLegacy 把可映射字段反向写回源台账。
func writeThroughToLegacy(tx *sql.Tx, projectID int64, asset *CmdbAsset, ch CmdbAssetChanges) error {
	if asset.SourceID <= 0 {
		return nil // 纯 CMDB 记录，没有源台账
	}
	now := time.Now().Format("2006-01-02 15:04:05")

	var sets []string
	var args []interface{}
	add := func(col string, val interface{}) {
		sets = append(sets, col+" = ?")
		args = append(args, val)
	}
	str := func(p *string) (string, bool) {
		if p == nil {
			return "", false
		}
		v := strings.TrimSpace(*p)
		return v, v != ""
	}

	switch asset.SourceType {
	case "legacy_asset":
		if v, ok := str(ch.Department); ok {
			add("department", v)
		}
		if v, ok := str(ch.Owner); ok {
			add("user_name", v)
		}
		if v, ok := str(ch.Remark); ok {
			add("remark", v)
		}
		if ch.Status != nil && strings.TrimSpace(*ch.Status) != "" {
			add("status", cmdbStatusToLegacyAsset(*ch.Status))
		}
		if len(sets) == 0 {
			return nil
		}
		args = append(args, now, asset.SourceID, projectID)
		result, err := tx.Exec("UPDATE assets SET "+strings.Join(sets, ", ")+", updated_at = ? WHERE id = ? AND project_id = ?", args...)
		return verifyLegacyWrite(asset, result, err)

	case "legacy_server":
		if v, ok := str(ch.Name); ok {
			add("device_name", v)
		}
		if v, ok := str(ch.Owner); ok {
			add("admin_user", v)
		}
		if v, ok := str(ch.Remark); ok {
			add("remark", v)
		}
		if v, ok := str(ch.CabinetName); ok {
			add("location", v)
		}
		if ch.Status != nil && strings.TrimSpace(*ch.Status) != "" {
			add("status", cmdbStatusToLegacyServer(*ch.Status))
		}
		if len(sets) == 0 {
			return nil
		}
		args = append(args, now, asset.SourceID, projectID)
		result, err := tx.Exec("UPDATE servers SET "+strings.Join(sets, ", ")+", updated_at = ? WHERE id = ? AND project_id = ?", args...)
		return verifyLegacyWrite(asset, result, err)
	}
	return nil
}

type cmdbRelationQuerier interface {
	QueryRow(query string, args ...interface{}) *sql.Row
}

func validateCmdbRelation(q cmdbRelationQuerier, projectID int64, table, label string, id int64) error {
	if id == 0 {
		return nil
	}
	var exists int
	err := q.QueryRow("SELECT 1 FROM "+table+" WHERE id = ? AND project_id = ? AND deleted_at IS NULL", id, projectID).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%s %d 不属于当前项目", label, id)
	}
	return err
}

func validateCmdbAssetRelations(q cmdbRelationQuerier, projectID int64, a *CmdbAsset) error {
	relations := []struct {
		table string
		label string
		id    int64
	}{
		{table: "cmdb_device_categories", label: "分类", id: a.CategoryID},
		{table: "cmdb_device_models", label: "型号", id: a.ModelID},
		{table: "cmdb_orgs", label: "组织", id: a.OrgID},
		{table: "cmdb_groups", label: "分组", id: a.GroupID},
		{table: "cmdb_persons", label: "人员", id: a.OwnerID},
	}
	for _, relation := range relations {
		if err := validateCmdbRelation(q, projectID, relation.table, relation.label, relation.id); err != nil {
			return err
		}
	}
	return nil
}

func validateCmdbAssetChangesRelations(q cmdbRelationQuerier, projectID int64, ch CmdbAssetChanges) error {
	relations := []struct {
		table string
		label string
		id    *int64
	}{
		{table: "cmdb_device_categories", label: "分类", id: ch.CategoryID},
		{table: "cmdb_orgs", label: "组织", id: ch.OrgID},
		{table: "cmdb_groups", label: "分组", id: ch.GroupID},
		{table: "cmdb_persons", label: "人员", id: ch.OwnerID},
	}
	for _, relation := range relations {
		if relation.id != nil {
			if err := validateCmdbRelation(q, projectID, relation.table, relation.label, *relation.id); err != nil {
				return err
			}
		}
	}
	return nil
}

// BackfillLegacyAssetOwner 补齐早期映射遗漏的「负责人」。
func (s *Store) BackfillLegacyAssetOwner() (int, error) {
	res, err := s.db.Exec(`
		UPDATE cmdb_assets SET owner = (
			SELECT IFNULL(a.user_name,'') FROM assets a WHERE a.id = cmdb_assets.source_id
		), updated_at = ?
		WHERE source_type = 'legacy_asset' AND source_id > 0
		  AND IFNULL(owner,'') = ''
		  AND EXISTS (SELECT 1 FROM assets a WHERE a.id = cmdb_assets.source_id AND IFNULL(a.user_name,'') <> '')`,
		time.Now().Format("2006-01-02 15:04:05"))
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

// ApplyCmdbAssetChanges 对一批 CMDB 资产应用变更，返回实际处理的条数。
func (s *Store) ApplyCmdbAssetChanges(ids []int64, ch CmdbAssetChanges) (int, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.ApplyCmdbAssetChangesForProject(scope, ids, ch)
}

func (s *Store) ApplyCmdbAssetChangesForProject(scope ProjectScope, ids []int64, ch CmdbAssetChanges) (int, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, fmt.Errorf("请先选择要操作的资产")
	}
	if ch.isEmpty() {
		return 0, fmt.Errorf("请至少填写一个需要变更的字段")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if err := validateCmdbAssetChangesRelations(tx, scope.ProjectID, ch); err != nil {
		return 0, err
	}

	if ch.Owner != nil && ch.OwnerID == nil {
		ownerID := int64(0)
		ch.OwnerID = &ownerID
	}
	if ch.OwnerID != nil && *ch.OwnerID != 0 {
		var owner, department string
		err := tx.QueryRow("SELECT name, department FROM cmdb_persons WHERE id = ? AND project_id = ?", *ch.OwnerID, scope.ProjectID).Scan(&owner, &department)
		if errors.Is(err, sql.ErrNoRows) {
			return 0, fmt.Errorf("人员 %d 不存在", *ch.OwnerID)
		}
		if err != nil {
			return 0, err
		}
		if ch.Owner == nil {
			ch.Owner = &owner
			if ch.Department == nil {
				ch.Department = &department
			}
		}
	}
	setClause, args, err := ch.build()
	if err != nil {
		return 0, err
	}
	now := time.Now().Format("2006-01-02 15:04:05")

	for _, id := range ids {
		cur := &CmdbAsset{ID: id}
		err := tx.QueryRow(`SELECT source_type, source_id, category_id, model_id, org_id, group_id, owner_id
			FROM cmdb_assets WHERE id = ? AND project_id = ?`, id, scope.ProjectID).Scan(
			&cur.SourceType, &cur.SourceID, &cur.CategoryID, &cur.ModelID, &cur.OrgID, &cur.GroupID, &cur.OwnerID,
		)
		if errors.Is(err, sql.ErrNoRows) {
			return 0, fmt.Errorf("资产 %d 不属于当前项目: %w", id, ErrProjectScopedNotFound)
		}
		if err != nil {
			return 0, err
		}
		effectiveRelations := *cur
		if ch.CategoryID != nil {
			effectiveRelations.CategoryID = *ch.CategoryID
		}
		if ch.OrgID != nil {
			effectiveRelations.OrgID = *ch.OrgID
		}
		if ch.GroupID != nil {
			effectiveRelations.GroupID = *ch.GroupID
		}
		if ch.OwnerID != nil {
			effectiveRelations.OwnerID = *ch.OwnerID
		}
		if err := validateCmdbAssetRelations(tx, scope.ProjectID, &effectiveRelations); err != nil {
			return 0, err
		}
		q := "UPDATE cmdb_assets SET " + setClause + ", updated_at = ? WHERE id = ? AND project_id = ?"
		if _, err := tx.Exec(q, append(append([]interface{}{}, args...), now, id, scope.ProjectID)...); err != nil {
			return 0, err
		}
		if err := writeThroughToLegacy(tx, scope.ProjectID, cur, ch); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return len(ids), nil
}

// ArchiveCmdbAssets 批量归档：把状态置为「报废」，并同步回源台账。
func (s *Store) ArchiveCmdbAssets(ids []int64) (int, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.ArchiveCmdbAssetsForProject(scope, ids)
}

func (s *Store) ArchiveCmdbAssetsForProject(scope ProjectScope, ids []int64) (int, error) {
	status := "报废"
	return s.ApplyCmdbAssetChangesForProject(scope, ids, CmdbAssetChanges{Status: &status})
}

// CloneCmdbAssets 批量克隆：复制为新记录（编号/SN/管理IP/MAC 清空，来源标记为 manual），
// 并一并复制网络接口。
func (s *Store) CloneCmdbAssets(ids []int64) (int, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.CloneCmdbAssetsForProject(scope, ids)
}

func (s *Store) CloneCmdbAssetsForProject(scope ProjectScope, ids []int64) (int, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, fmt.Errorf("请先选择要克隆的资产")
	}
	cloned := 0
	for _, id := range ids {
		src, ifaces, err := s.GetCmdbAssetForProject(scope, id)
		if err != nil {
			return cloned, fmt.Errorf("资产 %d 不存在", id)
		}
		cp := *src
		cp.ID = 0
		cp.ProjectID = 0
		cp.SyncID = ""
		cp.Name = src.Name + "-副本"
		cp.AssetCode = ""
		cp.SN = ""
		cp.MgmtIP = ""
		cp.ManageIP = ""
		cp.MAC = ""
		cp.MACAddress = ""
		cp.SourceType = "manual"
		cp.SourceID = 0

		// 克隆出的网络接口不带原 IP 与 MAC，避免 IP 冲突与 IP 池重复抢占
		clonedIfaces := make([]CmdbAssetInterface, 0, len(ifaces))
		for _, it := range ifaces {
			itCopy := it
			itCopy.ID = 0
			itCopy.AssetID = 0
			itCopy.IP = ""
			itCopy.AdditionalIPsJSON = "[]"
			itCopy.MAC = ""
			clonedIfaces = append(clonedIfaces, itCopy)
		}
		cp.Interfaces = clonedIfaces

		_, err = s.CreateCmdbAssetManualForProject(scope, &cp)
		if err != nil {
			return cloned, err
		}
		cloned++
	}
	return cloned, nil
}

func cmdbAssetIPs(asset *CmdbAsset, ifaces []CmdbAssetInterface) map[string]struct{} {
	ips := make(map[string]struct{})
	if asset != nil {
		for _, value := range []string{asset.MgmtIP, asset.ManageIP, asset.BizIP, asset.PublicIP} {
			if ip := strings.TrimSpace(value); ip != "" {
				ips[ip] = struct{}{}
			}
		}
	}
	for _, iface := range ifaces {
		if ip := strings.TrimSpace(iface.IP); ip != "" {
			ips[ip] = struct{}{}
		}
	}
	return ips
}

// linkCmdbAssetIPsToIPPool 在资产写事务内同步直接 IP 字段和多网卡 IP。
func linkCmdbAssetIPsToIPPool(tx *sql.Tx, projectID, assetID int64, oldAsset, newAsset *CmdbAsset, oldIfaces, newIfaces []CmdbAssetInterface) error {
	oldIPs := cmdbAssetIPs(oldAsset, oldIfaces)
	newIPs := cmdbAssetIPs(newAsset, newIfaces)

	for ip := range oldIPs {
		if _, exists := newIPs[ip]; !exists {
			if err := releaseUnreferencedIPInTx(tx, projectID, ip); err != nil {
				return err
			}
		}
	}

	if newAsset == nil {
		return nil
	}
	for ip := range newIPs {
		if err := ensureHostIPInDefinedSubnets(tx, projectID, ip); err != nil {
			return err
		}
		var poolID, ownerID int64
		var status, ownerType string
		err := tx.QueryRow("SELECT id, IFNULL(status,''), IFNULL(owner_type,''), IFNULL(owner_id,0) FROM ip_pool WHERE project_id=? AND ip=?", projectID, ip).
			Scan(&poolID, &status, &ownerType, &ownerID)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return err
		}
		_, alreadyUsedByAsset := oldIPs[ip]
		if status == "在用" && (ownerType != "infrastructure" || ownerID != assetID) && !alreadyUsedByAsset {
			return fmt.Errorf("IP %s 已被其他对象占用", ip)
		}
		remark := fmt.Sprintf("CMDB资产绑定 [%s]", newAsset.Name)
		if _, err := tx.Exec(`UPDATE ip_pool SET status='在用',department=?,account=?,room=?,remark=?,owner_type='infrastructure',owner_id=?,owner_name=? WHERE id=? AND project_id=?`,
			newAsset.Department, newAsset.Owner, newAsset.Room, remark, assetID, newAsset.Name, poolID, projectID); err != nil {
			return err
		}
	}
	return nil
}

// CreateCmdbAssetManual 手工新增一条 CMDB 资产记录（支持全部 48+ 项字段、多网卡接口与 IP 池联动）。
func (s *Store) CreateCmdbAssetManual(a *CmdbAsset) (int64, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.CreateCmdbAssetManualForProject(scope, a)
}

func (s *Store) CreateCmdbAssetManualForProject(scope ProjectScope, a *CmdbAsset) (int64, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	if err := validateCmdbAssetRelations(s.db, scope.ProjectID, a); err != nil {
		return 0, err
	}
	a.Name = strings.TrimSpace(a.Name)
	if a.Name == "" {
		return 0, fmt.Errorf("设备名称不能为空")
	}
	if a.SourceType == "" || a.SourceType == "legacy_asset" || a.SourceType == "legacy_server" {
		a.SourceType = "manual"
	}
	a.SourceID = 0

	now := time.Now().Format("2006-01-02 15:04:05")

	// 补齐同义字段
	if a.Status == "" {
		a.Status = "在库"
	}
	if a.AssetClass == "" {
		a.AssetClass = "physical"
	}
	if a.HeightU == 0 && a.UHeight > 0 {
		a.HeightU = a.UHeight
	}
	if a.HeightU == 0 {
		a.HeightU = 1
	}
	if a.UHeight == 0 {
		a.UHeight = a.HeightU
	}
	if a.UStart == 0 && a.StartU > 0 {
		a.UStart = a.StartU
	}
	if a.ManageIP == "" && a.MgmtIP != "" {
		a.ManageIP = a.MgmtIP
	}
	if a.MgmtIP == "" && a.ManageIP != "" {
		a.MgmtIP = a.ManageIP
	}
	if a.MACAddress == "" && a.MAC != "" {
		a.MACAddress = a.MAC
	}
	if a.MAC == "" && a.MACAddress != "" {
		a.MAC = a.MACAddress
	}
	if a.Area == "" && a.DataCenter != "" {
		a.Area = a.DataCenter
	}
	if a.DataCenter == "" && a.Area != "" {
		a.DataCenter = a.Area
	}
	if a.Description == "" && a.Remark != "" {
		a.Description = a.Remark
	}
	if a.Remark == "" && a.Description != "" {
		a.Remark = a.Description
	}
	if a.GeoAddress == "" && a.Address != "" {
		a.GeoAddress = a.Address
	}
	if a.Address == "" && a.GeoAddress != "" {
		a.Address = a.GeoAddress
	}
	if a.PurchaseAt == "" && a.InstallDate != "" {
		a.PurchaseAt = a.InstallDate
	}
	if a.InstallDate == "" && a.PurchaseAt != "" {
		a.InstallDate = a.PurchaseAt
	}
	if a.WarrantyAt == "" && a.WarrantyDate != "" {
		a.WarrantyAt = a.WarrantyDate
	}
	if a.WarrantyDate == "" && a.WarrantyAt != "" {
		a.WarrantyDate = a.WarrantyAt
	}
	if a.Organization == "" && a.OrgName != "" {
		a.Organization = a.OrgName
	}
	if a.OrgName == "" && a.Organization != "" {
		a.OrgName = a.Organization
	}
	if a.Country == "" {
		a.Country = "中国"
	}

	if len(a.CustomFields) > 0 {
		cfBytes, _ := json.Marshal(a.CustomFields)
		a.CustomFieldsJSON = string(cfBytes)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	query := `
		INSERT INTO cmdb_assets (
			project_id, asset_code, name, status, asset_class, category_id, model_id, sn, vendor, model, tags,
			org_id, group_id, department, owner, data_center, floor, cabinet_name, cabinet_row,
			cabinet_col, start_u, height_u, province, city, district, longitude, latitude, address,
			mgmt_ip, mac, port_count, rated_power_w, max_power_w, power_type, redundant_power,
			weight_kg, os_type, os_version, install_date, warranty_date, remark, source_type, source_id,
			device_type, manage_ip, mac_address, organization, group_name, area, cabinet_pos,
			u_height, u_start, purchase_at, warranty_at, description, country, geo_address, provider,
			region, zone, vcpu, memory_mb, instance_type, public_ip, box_sn, display_sn, cpu_info,
			disk_info, mgmt_url, biz_ip, rack_unit, security_software, net_type, admin_user, room,
			owner_id, custom_fields, created_at, updated_at)
		VALUES (` + strings.TrimRight(strings.Repeat("?,", 79), ",") + `)`

	res, err := tx.Exec(query,
		scope.ProjectID, a.AssetCode, a.Name, a.Status, a.AssetClass, a.CategoryID, a.ModelID, a.SN, a.Vendor, a.Model, a.Tags,
		a.OrgID, a.GroupID, a.Department, a.Owner, a.DataCenter, a.Floor, a.CabinetName, a.CabinetRow,
		a.CabinetCol, a.StartU, a.HeightU, a.Province, a.City, a.District, a.Longitude, a.Latitude, a.Address,
		a.MgmtIP, a.MAC, a.PortCount, a.RatedPowerW, a.MaxPowerW, a.PowerType, a.RedundantPower,
		a.WeightKG, a.OSType, a.OSVersion, a.InstallDate, a.WarrantyDate, a.Remark, a.SourceType, a.SourceID,
		a.DeviceType, a.ManageIP, a.MACAddress, a.Organization, a.GroupName, a.Area, a.CabinetPos,
		a.UHeight, a.UStart, a.PurchaseAt, a.WarrantyAt, a.Description, a.Country, a.GeoAddress, a.Provider,
		a.Region, a.Zone, a.VCPU, a.MemoryMB, a.InstanceType, a.PublicIP, a.BoxSN, a.DisplaySN, a.CPUInfo,
		a.DiskInfo, a.MgmtURL, a.BizIP, a.RackUnit, a.SecuritySoftware, a.NetType, a.AdminUser, a.Room,
		a.OwnerID, a.CustomFieldsJSON, now, now)
	if err != nil {
		return 0, err
	}
	newID, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	a.ID = newID
	a.ProjectID = scope.ProjectID
	if err := tx.QueryRow("SELECT sync_id FROM cmdb_assets WHERE id = ? AND project_id = ?", newID, scope.ProjectID).Scan(&a.SyncID); err != nil {
		return 0, err
	}

	// 插入多网卡接口
	for index := range a.Interfaces {
		iface := &a.Interfaces[index]
		if err := normalizeInterfaceAddresses(iface); err != nil {
			return 0, err
		}
		ifaceName := iface.Name
		if ifaceName == "" {
			ifaceName = iface.IfName
		}
		netZone := iface.NetworkZone
		if netZone == "" {
			netZone = iface.NetZone
		}
		_, err := tx.Exec(`
			INSERT INTO cmdb_asset_interfaces (
				project_id, asset_id, asset_name, name, if_name, ip, additional_ips_json, mask, gateway, mac,
				network_zone, net_zone, is_primary, vlan_id, remark, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			scope.ProjectID, newID, a.Name, ifaceName, ifaceName, iface.IP, interfaceAdditionalIPs(*iface), iface.Mask, iface.Gateway, iface.MAC,
			netZone, netZone, iface.IsPrimary, iface.VlanID, iface.Remark, now, now,
		)
		if err != nil {
			return 0, err
		}
	}

	// 联动 IP 池
	if err := linkCmdbAssetIPsToIPPool(tx, scope.ProjectID, newID, nil, a, nil, a.Interfaces); err != nil {
		return 0, err
	}
	if err := appendCmdbAssetHistory(tx, scope.ProjectID, newID, "资产建档", fmt.Sprintf("建立资产档案：%s", a.Name), "系统"); err != nil {
		return 0, err
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return newID, nil
}

// UpdateCmdbAssetManual 手工更新 CMDB 资产记录（支持全量 48+ 字段、多网卡与 IP 池联动更新）。
func (s *Store) UpdateCmdbAssetManual(a *CmdbAsset) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.UpdateCmdbAssetManualForProject(scope, a)
}

func (s *Store) UpdateCmdbAssetManualForProject(scope ProjectScope, a *CmdbAsset) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	if a.ID <= 0 {
		return fmt.Errorf("无效的资产 ID")
	}
	cur, oldIfaces, err := s.GetCmdbAssetForProject(scope, a.ID)
	if err != nil {
		return fmt.Errorf("资产不属于当前项目: %w", err)
	}
	if err := validateCmdbAssetRelations(s.db, scope.ProjectID, a); err != nil {
		return err
	}
	a.ProjectID = scope.ProjectID
	a.SyncID = cur.SyncID
	if strings.TrimSpace(a.Name) == "" {
		a.Name = cur.Name
	}
	now := time.Now().Format("2006-01-02 15:04:05")

	// 补齐同义字段
	if a.Status == "" {
		a.Status = cur.Status
	}
	if a.AssetClass == "" {
		a.AssetClass = cur.AssetClass
	}
	if a.HeightU == 0 && a.UHeight > 0 {
		a.HeightU = a.UHeight
	}
	if a.HeightU == 0 {
		a.HeightU = cur.HeightU
	}
	if a.UHeight == 0 {
		a.UHeight = a.HeightU
	}
	if a.UStart == 0 && a.StartU > 0 {
		a.UStart = a.StartU
	}
	if a.ManageIP == "" && a.MgmtIP != "" {
		a.ManageIP = a.MgmtIP
	}
	if a.MgmtIP == "" && a.ManageIP != "" {
		a.MgmtIP = a.ManageIP
	}
	if a.MACAddress == "" && a.MAC != "" {
		a.MACAddress = a.MAC
	}
	if a.MAC == "" && a.MACAddress != "" {
		a.MAC = a.MACAddress
	}
	if a.Area == "" && a.DataCenter != "" {
		a.Area = a.DataCenter
	}
	if a.DataCenter == "" && a.Area != "" {
		a.DataCenter = a.Area
	}
	if a.Description == "" && a.Remark != "" {
		a.Description = a.Remark
	}
	if a.Remark == "" && a.Description != "" {
		a.Remark = a.Description
	}
	if a.GeoAddress == "" && a.Address != "" {
		a.GeoAddress = a.Address
	}
	if a.Address == "" && a.GeoAddress != "" {
		a.Address = a.GeoAddress
	}
	if a.PurchaseAt == "" && a.InstallDate != "" {
		a.PurchaseAt = a.InstallDate
	}
	if a.InstallDate == "" && a.PurchaseAt != "" {
		a.InstallDate = a.PurchaseAt
	}
	if a.WarrantyAt == "" && a.WarrantyDate != "" {
		a.WarrantyAt = a.WarrantyDate
	}
	if a.WarrantyDate == "" && a.WarrantyAt != "" {
		a.WarrantyDate = a.WarrantyAt
	}
	if a.Organization == "" && a.OrgName != "" {
		a.Organization = a.OrgName
	}
	if a.OrgName == "" && a.Organization != "" {
		a.OrgName = a.Organization
	}
	if a.Country == "" {
		a.Country = "中国"
	}

	if len(a.CustomFields) > 0 {
		cfBytes, _ := json.Marshal(a.CustomFields)
		a.CustomFieldsJSON = string(cfBytes)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec(`
		UPDATE cmdb_assets SET
			asset_code = ?, name = ?, status = ?, asset_class = ?, category_id = ?, model_id = ?,
			sn = ?, vendor = ?, model = ?, tags = ?, org_id = ?, group_id = ?, department = ?,
			owner = ?, data_center = ?, floor = ?, cabinet_name = ?, cabinet_row = ?,
			cabinet_col = ?, start_u = ?, height_u = ?, province = ?, city = ?, district = ?,
			longitude = ?, latitude = ?, address = ?, mgmt_ip = ?, mac = ?, port_count = ?,
			rated_power_w = ?, max_power_w = ?, power_type = ?, redundant_power = ?,
			weight_kg = ?, os_type = ?, os_version = ?, install_date = ?, warranty_date = ?,
			remark = ?, device_type = ?, manage_ip = ?, mac_address = ?, organization = ?,
			group_name = ?, area = ?, cabinet_pos = ?, u_height = ?, u_start = ?,
			purchase_at = ?, warranty_at = ?, description = ?, country = ?, geo_address = ?,
			provider = ?, region = ?, zone = ?, vcpu = ?, memory_mb = ?, instance_type = ?,
			public_ip = ?, box_sn = ?, display_sn = ?, cpu_info = ?, disk_info = ?,
			mgmt_url = ?, biz_ip = ?, rack_unit = ?, security_software = ?, net_type = ?,
			admin_user = ?, room = ?, owner_id = ?, custom_fields = ?, updated_at = ?
		WHERE id = ? AND project_id = ?`,
		a.AssetCode, a.Name, a.Status, a.AssetClass, a.CategoryID, a.ModelID,
		a.SN, a.Vendor, a.Model, a.Tags, a.OrgID, a.GroupID, a.Department,
		a.Owner, a.DataCenter, a.Floor, a.CabinetName, a.CabinetRow,
		a.CabinetCol, a.StartU, a.HeightU, a.Province, a.City, a.District,
		a.Longitude, a.Latitude, a.Address, a.MgmtIP, a.MAC, a.PortCount,
		a.RatedPowerW, a.MaxPowerW, a.PowerType, a.RedundantPower,
		a.WeightKG, a.OSType, a.OSVersion, a.InstallDate, a.WarrantyDate,
		a.Remark, a.DeviceType, a.ManageIP, a.MACAddress, a.Organization,
		a.GroupName, a.Area, a.CabinetPos, a.UHeight, a.UStart,
		a.PurchaseAt, a.WarrantyAt, a.Description, a.Country, a.GeoAddress,
		a.Provider, a.Region, a.Zone, a.VCPU, a.MemoryMB, a.InstanceType,
		a.PublicIP, a.BoxSN, a.DisplaySN, a.CPUInfo, a.DiskInfo,
		a.MgmtURL, a.BizIP, a.RackUnit, a.SecuritySoftware, a.NetType,
		a.AdminUser, a.Room, a.OwnerID, a.CustomFieldsJSON, now, a.ID, scope.ProjectID,
	)
	if err != nil {
		return err
	}

	// 保留既有接口编号，确保上下联关系继续引用同一接口。
	if a.Interfaces != nil {
		if err := updateCmdbAssetInterfaces(tx, scope.ProjectID, a, oldIfaces, now); err != nil {
			return err
		}
	}
	effectiveIfaces := oldIfaces
	if a.Interfaces != nil {
		effectiveIfaces = a.Interfaces
	}
	if err := linkCmdbAssetIPsToIPPool(tx, scope.ProjectID, a.ID, cur, a, oldIfaces, effectiveIfaces); err != nil {
		return err
	}

	// 源台账写穿
	if cur.SourceID > 0 {
		ch := CmdbAssetChanges{
			Status:      &a.Status,
			Department:  &a.Department,
			Owner:       &a.Owner,
			CabinetName: &a.CabinetName,
			Remark:      &a.Remark,
		}
		if err := writeThroughToLegacy(tx, scope.ProjectID, cur, ch); err != nil {
			return err
		}
	}
	if err := appendCmdbAssetHistory(tx, scope.ProjectID, a.ID, "资产修改", "更新资产基础信息或网络配置", "系统"); err != nil {
		return err
	}

	return tx.Commit()
}

// DeleteCmdbAsset 删除一条 CMDB 记录。
// 由旧台账映射而来的记录不允许删除——删掉后下次同步会重新出现，属于无效且误导的操作。
// 同时释放其名下绑定的网卡 IP。
func (s *Store) DeleteCmdbAsset(id int64) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.DeleteCmdbAssetForProject(scope, id)
}

func (s *Store) DeleteCmdbAssetForProject(scope ProjectScope, id int64) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	cur, ifaces, err := s.GetCmdbAssetForProject(scope, id)
	if err != nil {
		return fmt.Errorf("资产不属于当前项目: %w", err)
	}
	if cur.SourceID > 0 {
		src := "终端资产台账"
		if cur.SourceType == "legacy_server" {
			src = "基础设施与业务系统"
		}
		return fmt.Errorf("该记录由「%s」映射而来，删除后下次同步会重新出现；如需停用请改为「归档」，或到源台账中注销", src)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM cmdb_asset_interfaces WHERE asset_id = ? AND project_id = ?`, id, scope.ProjectID); err != nil {
		return err
	}
	res, err := tx.Exec(`DELETE FROM cmdb_assets WHERE id = ? AND project_id = ?`, id, scope.ProjectID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("资产不存在")
	}
	if err := linkCmdbAssetIPsToIPPool(tx, scope.ProjectID, id, cur, nil, ifaces, nil); err != nil {
		return err
	}
	return tx.Commit()
}
