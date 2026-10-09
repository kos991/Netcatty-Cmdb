package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

func isCmdbServerAssetType(deviceType, categoryName string) bool {
	typeName := strings.ToLower(strings.TrimSpace(deviceType + " " + categoryName))
	return strings.Contains(typeName, "server") ||
		strings.Contains(typeName, "服务器") ||
		strings.Contains(typeName, "物理主机") ||
		strings.Contains(typeName, "虚拟机") ||
		strings.Contains(typeName, "virtual_machine") ||
		strings.Contains(typeName, "云主机") ||
		strings.Contains(typeName, "云资源") ||
		strings.Contains(typeName, "ecs") ||
		strings.Contains(typeName, "超融合") ||
		strings.Contains(typeName, "hci")
}

func isCmdbApplicationHostType(deviceType, categoryName string) bool {
	typeName := strings.ToLower(strings.TrimSpace(deviceType + " " + categoryName))
	return !strings.Contains(typeName, "switch") &&
		!strings.Contains(typeName, "router") &&
		!strings.Contains(typeName, "交换机") &&
		!strings.Contains(typeName, "路由器")
}

// CmdbAsset 对应 cmdb_assets 表，涵盖全部 48+ 主字段及 custom_fields 字典与 interfaces 数组。
type CmdbAsset struct {
	ID             int64   `json:"id"`
	ProjectID      int64   `json:"project_id"`
	SyncID         string  `json:"sync_id"`
	AssetCode      string  `json:"asset_code"`
	Name           string  `json:"name"`
	Status         string  `json:"status"`
	AssetClass     string  `json:"asset_class"`
	CategoryID     int64   `json:"category_id"`
	CategoryName   string  `json:"category_name"`
	ModelID        int64   `json:"model_id"`
	SN             string  `json:"sn"`
	Vendor         string  `json:"vendor"`
	Model          string  `json:"model"`
	Tags           string  `json:"tags"`
	OrgID          int64   `json:"org_id"`
	OrgName        string  `json:"org_name"`
	GroupID        int64   `json:"group_id"`
	GroupName      string  `json:"group_name"`
	Department     string  `json:"department"`
	Owner          string  `json:"owner"`
	DataCenter     string  `json:"data_center"`
	Floor          string  `json:"floor"`
	CabinetName    string  `json:"cabinet_name"`
	CabinetRow     string  `json:"cabinet_row"`
	CabinetCol     int64   `json:"cabinet_col"`
	StartU         int64   `json:"start_u"`
	HeightU        int64   `json:"height_u"`
	Province       string  `json:"province"`
	City           string  `json:"city"`
	District       string  `json:"district"`
	Longitude      float64 `json:"longitude"`
	Latitude       float64 `json:"latitude"`
	Address        string  `json:"address"`
	MgmtIP         string  `json:"mgmt_ip"`
	MAC            string  `json:"mac"`
	PortCount      int64   `json:"port_count"`
	RatedPowerW    int64   `json:"rated_power_w"`
	MaxPowerW      int64   `json:"max_power_w"`
	PowerType      string  `json:"power_type"`
	RedundantPower int64   `json:"redundant_power"`
	WeightKG       float64 `json:"weight_kg"`
	OSType         string  `json:"os_type"`
	OSVersion      string  `json:"os_version"`
	InstallDate    string  `json:"install_date"`
	WarrantyDate   string  `json:"warranty_date"`
	Remark         string  `json:"remark"`
	SourceType     string  `json:"source_type"`
	SourceID       int64   `json:"source_id"`
	CreatedAt      string  `json:"created_at"`
	UpdatedAt      string  `json:"updated_at"`

	// 48+ 扩展字段与规范对齐字段
	DeviceType       string                 `json:"device_type"`
	ManageIP         string                 `json:"manage_ip"`
	MACAddress       string                 `json:"mac_address"`
	Organization     string                 `json:"organization"`
	Area             string                 `json:"area"`
	CabinetPos       string                 `json:"cabinet_pos"`
	UHeight          int64                  `json:"u_height"`
	UStart           int64                  `json:"u_start"`
	PurchaseAt       string                 `json:"purchase_at"`
	WarrantyAt       string                 `json:"warranty_at"`
	Description      string                 `json:"description"`
	Country          string                 `json:"country"`
	GeoAddress       string                 `json:"geo_address"`
	Provider         string                 `json:"provider"`
	Region           string                 `json:"region"`
	Zone             string                 `json:"zone"`
	VCPU             int64                  `json:"vcpu"`
	MemoryMB         int64                  `json:"memory_mb"`
	InstanceType     string                 `json:"instance_type"`
	PublicIP         string                 `json:"public_ip"`
	BoxSN            string                 `json:"box_sn"`
	DisplaySN        string                 `json:"display_sn"`
	CPUInfo          string                 `json:"cpu_info"`
	DiskInfo         string                 `json:"disk_info"`
	MgmtURL          string                 `json:"mgmt_url"`
	BizIP            string                 `json:"biz_ip"`
	RackUnit         string                 `json:"rack_unit"`
	SecuritySoftware string                 `json:"security_software"`
	NetType          string                 `json:"net_type"`
	AdminUser        string                 `json:"admin_user"`
	Room             string                 `json:"room"`
	OwnerID          int64                  `json:"owner_id"`
	CustomFields     map[string]interface{} `json:"custom_fields,omitempty"`
	CustomFieldsJSON string                 `json:"-"`
	Interfaces       []CmdbAssetInterface   `json:"interfaces,omitempty"`
}

// CmdbAssetInterface 对应 cmdb_asset_interfaces 表。
type CmdbAssetInterface struct {
	ID                int64  `json:"id"`
	AssetID           int64  `json:"asset_id"`
	AssetName         string `json:"asset_name"`
	Name              string `json:"name"`
	IfName            string `json:"if_name"`
	IP                string `json:"ip"`
	AdditionalIPsJSON string `json:"additional_ips_json"`
	Mask              string `json:"mask"`
	Gateway           string `json:"gateway"`
	MAC               string `json:"mac"`
	NetworkZone       string `json:"network_zone"`
	NetZone           string `json:"net_zone"`
	IsPrimary         int64  `json:"is_primary"`
	VlanID            int64  `json:"vlan_id"`
	Remark            string `json:"remark"`
}

// CmdbAssetQuery 是资源列表的查询条件。
type CmdbAssetQuery struct {
	Keyword       string
	CategoryID    int64
	OrgID         int64
	GroupID       int64
	Department    string
	Owner         string
	OwnerID       int64
	Vendor        string
	Model         string
	NetType       string
	Status        string
	AssetClass    string
	DeviceType    string
	OSType        string
	OSVersion     string
	MgmtIP        string
	Location      string
	SourceType    string
	ResourceScope string
	Page          int
	PageSize      int
	SortBy        string
	SortOrder     string
}

const CmdbAssetUnconfiguredFilter = "__unconfigured__"

// 只有白名单内的字段允许出现在 ORDER BY 中，防止 SQL 注入。
var cmdbSortWhitelist = map[string]string{
	"asset_code":    "a.asset_code",
	"name":          "a.name",
	"status":        "a.status",
	"category":      "a.category_id",
	"org":           "a.org_id",
	"os_type":       "a.os_type",
	"os_version":    "a.os_version",
	"mgmt_ip":       "a.mgmt_ip",
	"install_date":  "a.install_date",
	"warranty_date": "a.warranty_date",
	"updated_at":    "a.updated_at",
}

const cmdbAssetSelect = `
SELECT a.id, a.project_id, IFNULL(a.sync_id,''), IFNULL(a.asset_code,''), a.name, a.status, a.asset_class,
       a.category_id, IFNULL(c.name,''), a.model_id, IFNULL(a.sn,''), IFNULL(a.vendor,''),
       IFNULL(a.model,''), IFNULL(a.tags,''), a.org_id, IFNULL(o.name,''), a.group_id,
       COALESCE(NULLIF(g.name,''), IFNULL(a.group_name,'')), IFNULL(a.department,''), IFNULL(a.owner,''), IFNULL(a.data_center,''),
       IFNULL(a.floor,''), IFNULL(a.cabinet_name,''), IFNULL(a.cabinet_row,''), a.cabinet_col,
       a.start_u, a.height_u, IFNULL(a.province,''), IFNULL(a.city,''), IFNULL(a.district,''),
       IFNULL(a.longitude,0), IFNULL(a.latitude,0), IFNULL(a.address,''), IFNULL(a.mgmt_ip,''),
       IFNULL(a.mac,''), a.port_count, a.rated_power_w, a.max_power_w, IFNULL(a.power_type,''),
       a.redundant_power, IFNULL(a.weight_kg,0), IFNULL(a.os_type,''), IFNULL(a.os_version,''),
       IFNULL(a.install_date,''), IFNULL(a.warranty_date,''), IFNULL(a.remark,''),
       a.source_type, a.source_id, IFNULL(a.created_at,''), IFNULL(a.updated_at,''),
       -- 48+ 扩展字段
       IFNULL(a.device_type,''), IFNULL(a.manage_ip,''), IFNULL(a.mac_address,''),
       IFNULL(a.organization,''), IFNULL(a.area,''),
       IFNULL(a.cabinet_pos,''), a.u_height, a.u_start, IFNULL(a.purchase_at,''),
       IFNULL(a.warranty_at,''), IFNULL(a.description,''), IFNULL(a.country,'中国'),
       IFNULL(a.geo_address,''), IFNULL(a.provider,''), IFNULL(a.region,''),
       IFNULL(a.zone,''), a.vcpu, a.memory_mb, IFNULL(a.instance_type,''),
       IFNULL(a.public_ip,''), IFNULL(a.box_sn,''), IFNULL(a.display_sn,''),
       IFNULL(a.cpu_info,''), IFNULL(a.disk_info,''), IFNULL(a.mgmt_url,''),
       IFNULL(a.biz_ip,''), IFNULL(a.rack_unit,''), IFNULL(a.security_software,''),
       IFNULL(a.net_type,''), IFNULL(a.admin_user,''), IFNULL(a.room,''),
       a.owner_id, IFNULL(a.custom_fields,'')
FROM cmdb_assets a
LEFT JOIN cmdb_orgs o ON o.id = a.org_id AND o.project_id = a.project_id
LEFT JOIN cmdb_groups g ON g.id = a.group_id AND g.project_id = a.project_id
LEFT JOIN cmdb_device_categories c ON c.id = a.category_id AND c.project_id = a.project_id`

func scanCmdbAsset(rows interface {
	Scan(dest ...interface{}) error
}) (CmdbAsset, error) {
	var a CmdbAsset
	err := rows.Scan(
		&a.ID, &a.ProjectID, &a.SyncID, &a.AssetCode, &a.Name, &a.Status, &a.AssetClass,
		&a.CategoryID, &a.CategoryName, &a.ModelID, &a.SN, &a.Vendor,
		&a.Model, &a.Tags, &a.OrgID, &a.OrgName, &a.GroupID,
		&a.GroupName, &a.Department, &a.Owner, &a.DataCenter,
		&a.Floor, &a.CabinetName, &a.CabinetRow, &a.CabinetCol,
		&a.StartU, &a.HeightU, &a.Province, &a.City, &a.District,
		&a.Longitude, &a.Latitude, &a.Address, &a.MgmtIP,
		&a.MAC, &a.PortCount, &a.RatedPowerW, &a.MaxPowerW, &a.PowerType,
		&a.RedundantPower, &a.WeightKG, &a.OSType, &a.OSVersion,
		&a.InstallDate, &a.WarrantyDate, &a.Remark,
		&a.SourceType, &a.SourceID, &a.CreatedAt, &a.UpdatedAt,
		// 扩展字段
		&a.DeviceType, &a.ManageIP, &a.MACAddress,
		&a.Organization, &a.Area,
		&a.CabinetPos, &a.UHeight, &a.UStart, &a.PurchaseAt,
		&a.WarrantyAt, &a.Description, &a.Country,
		&a.GeoAddress, &a.Provider, &a.Region,
		&a.Zone, &a.VCPU, &a.MemoryMB, &a.InstanceType,
		&a.PublicIP, &a.BoxSN, &a.DisplaySN,
		&a.CPUInfo, &a.DiskInfo, &a.MgmtURL,
		&a.BizIP, &a.RackUnit, &a.SecuritySoftware,
		&a.NetType, &a.AdminUser, &a.Room,
		&a.OwnerID, &a.CustomFieldsJSON,
	)
	if err != nil {
		return a, err
	}

	// 动态 JSON 解析
	if a.CustomFieldsJSON != "" {
		_ = json.Unmarshal([]byte(a.CustomFieldsJSON), &a.CustomFields)
	}
	if a.CustomFields == nil {
		a.CustomFields = map[string]interface{}{}
	}

	// 同义字段双向对齐
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
	if a.UHeight == 0 && a.HeightU > 0 {
		a.UHeight = a.HeightU
	}
	if a.HeightU == 0 && a.UHeight > 0 {
		a.HeightU = a.UHeight
	}
	if a.UStart == 0 && a.StartU > 0 {
		a.UStart = a.StartU
	}
	if a.StartU == 0 && a.UStart > 0 {
		a.StartU = a.UStart
	}
	if a.Country == "" {
		a.Country = "中国"
	}

	return a, nil
}

func cmdbDeviceTypeAliases(value string) []string {
	typeName := strings.ToLower(strings.TrimSpace(value))
	switch typeName {
	case "server", "physical_server", "服务器", "物理服务器", "物理主机":
		return []string{"server", "physical_server", "服务器", "物理服务器", "物理主机"}
	case "virtual_machine", "vm", "虚拟机", "云主机", "云资源", "ecs":
		return []string{"virtual_machine", "vm", "虚拟机", "云主机", "云资源", "ecs"}
	case "hyperconverged", "hci", "超融合", "超融合集群", "超融合节点":
		return []string{"hyperconverged", "hci", "超融合", "超融合集群", "超融合节点"}
	case "switch", "交换机":
		return []string{"switch", "交换机"}
	case "router", "路由器":
		return []string{"router", "路由器"}
	case "security_device", "security", "安全设备", "防火墙", "网闸", "负载均衡":
		return []string{"security_device", "security", "安全设备", "防火墙", "网闸", "负载均衡"}
	case "storage", "存储", "存储设备":
		return []string{"storage", "存储", "存储设备"}
	case "cloud_desktop", "云桌面", "云桌面平台", "桌面池":
		return []string{"cloud_desktop", "云桌面", "云桌面平台", "桌面池"}
	default:
		return []string{typeName}
	}
}

func (s *Store) buildCmdbWhere(q CmdbAssetQuery) (string, []interface{}) {
	var where []string
	var args []interface{}

	if kw := strings.TrimSpace(q.Keyword); kw != "" {
		pat := "%" + kw + "%"
		where = append(where, `(a.name LIKE ? OR a.asset_code LIKE ? OR a.sn LIKE ?
			OR a.mgmt_ip LIKE ? OR a.manage_ip LIKE ? OR a.model LIKE ? OR a.owner LIKE ? OR a.department LIKE ?)`)
		args = append(args, pat, pat, pat, pat, pat, pat, pat, pat)
	}
	deviceType := strings.TrimSpace(q.DeviceType)
	if q.CategoryID > 0 {
		where = append(where, "a.category_id = ?")
		args = append(args, q.CategoryID)
	} else if q.CategoryID == -1 {
		where = append(where, "IFNULL(a.category_id,0) = 0")
	} else if deviceType != "" && deviceType != "全部" {
		aliases := cmdbDeviceTypeAliases(deviceType)
		placeholders := make([]string, len(aliases))
		for i, alias := range aliases {
			placeholders[i] = "?"
			args = append(args, alias)
		}
		where = append(where, `lower(trim(COALESCE(NULLIF(trim(a.device_type),''),
			(SELECT type_category.name FROM cmdb_device_categories type_category
			 WHERE type_category.id = a.category_id AND type_category.project_id = a.project_id),''))) IN (`+strings.Join(placeholders, ",")+")")
	}
	if q.OrgID > 0 {
		where = append(where, "a.org_id = ?")
		args = append(args, q.OrgID)
	}
	if q.GroupID == -1 {
		where = append(where, "IFNULL(a.group_id,0) = 0")
	} else if q.GroupID > 0 {
		where = append(where, "a.group_id = ?")
		args = append(args, q.GroupID)
	}
	appendCmdbExactFilter(&where, &args, "a.department", q.Department)
	appendCmdbExactFilter(&where, &args, "a.owner", q.Owner)
	appendCmdbExactFilter(&where, &args, "a.vendor", q.Vendor)
	appendCmdbExactFilter(&where, &args, "a.model", q.Model)
	if q.OwnerID > 0 {
		where = append(where, "a.owner_id = ?")
		args = append(args, q.OwnerID)
	}
	appendCmdbExactFilter(&where, &args, "a.status", q.Status)
	if cls := strings.TrimSpace(q.AssetClass); cls != "" && cls != "全部" {
		where = append(where, "a.asset_class = ?")
		args = append(args, cls)
	}
	appendCmdbExactFilter(&where, &args, "a.os_type", q.OSType)
	appendCmdbExactFilter(&where, &args, "a.os_version", q.OSVersion)
	if location := strings.TrimSpace(q.Location); location != "" && location != "全部" {
		locationColumns := []string{"a.room", "a.data_center", "a.floor", "a.cabinet_name", "a.area", "a.cabinet_pos"}
		if location == CmdbAssetUnconfiguredFilter {
			checks := make([]string, 0, len(locationColumns))
			for _, column := range locationColumns {
				checks = append(checks, "TRIM(IFNULL("+column+",'')) = ''")
			}
			where = append(where, "("+strings.Join(checks, " AND ")+")")
		} else {
			checks := make([]string, 0, len(locationColumns))
			for _, column := range locationColumns {
				checks = append(checks, "TRIM(IFNULL("+column+",'')) = ?")
				args = append(args, location)
			}
			where = append(where, "("+strings.Join(checks, " OR ")+")")
		}
	}
	if netType := strings.TrimSpace(q.NetType); netType != "" && netType != "全部" {
		interfaceZone := `EXISTS (SELECT 1 FROM cmdb_asset_interfaces i WHERE i.asset_id=a.id AND (IFNULL(i.network_zone,'') = ? OR IFNULL(i.net_zone,'') = ?))`
		if netType == CmdbAssetUnconfiguredFilter {
			where = append(where, `IFNULL(a.net_type,'') = '' AND NOT EXISTS (SELECT 1 FROM cmdb_asset_interfaces i WHERE i.asset_id=a.id AND (IFNULL(i.network_zone,'') <> '' OR IFNULL(i.net_zone,'') <> ''))`)
		} else {
			where = append(where, "(IFNULL(a.net_type,'') = ? OR "+interfaceZone+")")
			args = append(args, netType, netType, netType)
		}
	}
	if v := strings.TrimSpace(q.MgmtIP); v != "" && v != "全部" {
		where = append(where, "(IFNULL(a.mgmt_ip,'') LIKE ? OR IFNULL(a.manage_ip,'') LIKE ?)")
		args = append(args, "%"+v+"%", "%"+v+"%")
	}
	if v := strings.TrimSpace(q.SourceType); v != "" && v != "全部" {
		where = append(where, "a.source_type = ?")
		args = append(args, v)
	}
	if strings.EqualFold(strings.TrimSpace(q.ResourceScope), "infrastructure") {
		where = append(where, `(a.source_type = 'legacy_server'
			OR (a.source_type = 'manual' AND IFNULL(a.device_type,'') = '' AND IFNULL(a.category_id,0) = 0)
			OR lower(IFNULL(a.device_type,'')) IN ('server','physical_server','virtual_machine','switch','router','security_device','storage','hyperconverged','hci','超融合','cloud_desktop')
			OR EXISTS (
				SELECT 1 FROM cmdb_device_categories scope_category
				WHERE scope_category.id = a.category_id
				AND scope_category.project_id = a.project_id
				AND (scope_category.name LIKE '%服务器%'
					OR scope_category.name LIKE '%虚拟机%'
					OR scope_category.name LIKE '%超融合%'
					OR scope_category.name LIKE '%交换机%'
					OR scope_category.name LIKE '%网络设备%'
					OR scope_category.name LIKE '%路由器%'
					OR scope_category.name LIKE '%安全设备%'
					OR scope_category.name LIKE '%存储设备%'
					OR scope_category.name LIKE '%云桌面平台%'
					OR scope_category.name LIKE '%桌面池%')
			))`)
	}

	clause := ""
	if len(where) > 0 {
		clause = " WHERE " + strings.Join(where, " AND ")
	}
	return clause, args
}

// CmdbAssetLocationSummary 生成列表导出共用的基础设施位置摘要。
func CmdbAssetLocationSummary(a CmdbAsset) string {
	parts := make([]string, 0, 7)
	appendUnique := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		for _, current := range parts {
			if current == value {
				return
			}
		}
		parts = append(parts, value)
	}
	appendUnique(a.Room)
	if strings.TrimSpace(a.DataCenter) != "" {
		appendUnique(a.DataCenter)
	} else {
		appendUnique(a.Area)
	}
	appendUnique(a.Floor)
	if strings.TrimSpace(a.CabinetName) != "" {
		appendUnique(a.CabinetName)
	} else {
		appendUnique(a.CabinetPos)
	}
	rowColumn := make([]string, 0, 2)
	if value := strings.TrimSpace(a.CabinetRow); value != "" {
		rowColumn = append(rowColumn, value)
	}
	if a.CabinetCol > 0 {
		rowColumn = append(rowColumn, fmt.Sprintf("%d 列", a.CabinetCol))
	}
	appendUnique(strings.Join(rowColumn, " / "))
	start, height := a.StartU, a.HeightU
	if start == 0 {
		start = a.UStart
	}
	if height == 0 {
		height = a.UHeight
	}
	if start > 0 && height > 1 {
		appendUnique(fmt.Sprintf("%dU–%dU", start, start+height-1))
	} else if start > 0 {
		appendUnique(fmt.Sprintf("%dU", start))
	} else {
		appendUnique(a.RackUnit)
	}
	return strings.Join(parts, " · ")
}

func appendCmdbExactFilter(where *[]string, args *[]interface{}, column, value string) {
	value = strings.TrimSpace(value)
	if value == "" || value == "全部" {
		return
	}
	if value == CmdbAssetUnconfiguredFilter {
		*where = append(*where, "IFNULL("+column+",'') = ''")
		return
	}
	*where = append(*where, column+" = ?")
	*args = append(*args, value)
}

func (s *Store) buildCmdbWhereForProject(scope ProjectScope, q CmdbAssetQuery) (string, []interface{}) {
	whereClause, args := s.buildCmdbWhere(q)
	projectWhere := " WHERE a.project_id = ?"
	if whereClause != "" {
		projectWhere += " AND " + strings.TrimPrefix(whereClause, " WHERE ")
	}
	return projectWhere, append([]interface{}{scope.ProjectID}, args...)
}

// QueryCmdbAssets 按条件分页查询 CMDB 资产，返回当前页数据与满足条件的总数。
func (s *Store) QueryCmdbAssets(q CmdbAssetQuery) ([]CmdbAsset, int, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, 0, err
	}
	return s.QueryCmdbAssetsForProject(scope, q)
}

func (s *Store) QueryCmdbAssetsForProject(scope ProjectScope, q CmdbAssetQuery) ([]CmdbAsset, int, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, 0, err
	}
	if q.Page < 1 {
		q.Page = 1
	}
	if q.PageSize < 1 || q.PageSize > 500 {
		q.PageSize = 10
	}

	whereClause, args := s.buildCmdbWhereForProject(scope, q)

	var total int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM cmdb_assets a"+whereClause, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	orderCol, ok := cmdbSortWhitelist[q.SortBy]
	if !ok {
		orderCol = "a.id"
	}
	direction := "ASC"
	if strings.EqualFold(q.SortOrder, "desc") {
		direction = "DESC"
	}

	query := cmdbAssetSelect + whereClause +
		fmt.Sprintf(" ORDER BY %s %s LIMIT ? OFFSET ?", orderCol, direction)
	queryArgs := append(append([]interface{}{}, args...), q.PageSize, (q.Page-1)*q.PageSize)

	rows, err := s.db.Query(query, queryArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	list := make([]CmdbAsset, 0, q.PageSize)
	for rows.Next() {
		item, err := scanCmdbAsset(rows)
		if err != nil {
			return nil, 0, err
		}
		list = append(list, item)
	}
	return list, total, rows.Err()
}

func (s *Store) AttachCmdbAssetInterfacesForProject(scope ProjectScope, assets []CmdbAsset) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	if len(assets) == 0 {
		return nil
	}
	ids := make([]interface{}, 0, len(assets)+1)
	placeholders := make([]string, 0, len(assets))
	for _, asset := range assets {
		placeholders = append(placeholders, "?")
		ids = append(ids, asset.ID)
	}
	ids = append([]interface{}{scope.ProjectID}, ids...)
	rows, err := s.db.Query(`SELECT id, asset_id, IFNULL(asset_name,''), IFNULL(name,''), IFNULL(if_name,''),
		IFNULL(ip,''), IFNULL(additional_ips_json,'[]'), IFNULL(mask,''), IFNULL(gateway,''), IFNULL(mac,''),
		IFNULL(network_zone,''), IFNULL(net_zone,''), is_primary, vlan_id, IFNULL(remark,'')
		FROM cmdb_asset_interfaces WHERE project_id=? AND asset_id IN (`+strings.Join(placeholders, ",")+") ORDER BY asset_id, is_primary DESC, id ASC", ids...)
	if err != nil {
		return err
	}
	defer rows.Close()
	interfacesByAsset := make(map[int64][]CmdbAssetInterface, len(assets))
	for rows.Next() {
		var iface CmdbAssetInterface
		if err := rows.Scan(&iface.ID, &iface.AssetID, &iface.AssetName, &iface.Name, &iface.IfName,
			&iface.IP, &iface.AdditionalIPsJSON, &iface.Mask, &iface.Gateway, &iface.MAC,
			&iface.NetworkZone, &iface.NetZone, &iface.IsPrimary, &iface.VlanID, &iface.Remark); err != nil {
			return err
		}
		if iface.Name == "" && iface.IfName != "" {
			iface.Name = iface.IfName
		}
		if iface.IfName == "" && iface.Name != "" {
			iface.IfName = iface.Name
		}
		if iface.NetworkZone == "" && iface.NetZone != "" {
			iface.NetworkZone = iface.NetZone
		}
		if iface.NetZone == "" && iface.NetworkZone != "" {
			iface.NetZone = iface.NetworkZone
		}
		if err := normalizeInterfaceAddresses(&iface); err != nil {
			return err
		}
		interfacesByAsset[iface.AssetID] = append(interfacesByAsset[iface.AssetID], iface)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for index := range assets {
		assets[index].Interfaces = interfacesByAsset[assets[index].ID]
		if assets[index].Interfaces == nil {
			assets[index].Interfaces = []CmdbAssetInterface{}
		}
	}
	return nil
}

// GetCmdbAsset 读取单个资产及其全部网络接口。
func (s *Store) GetCmdbAsset(id int64) (*CmdbAsset, []CmdbAssetInterface, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, nil, err
	}
	return s.GetCmdbAssetForProject(scope, id)
}

func (s *Store) GetCmdbAssetForProject(scope ProjectScope, id int64) (*CmdbAsset, []CmdbAssetInterface, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, nil, err
	}
	row := s.db.QueryRow(cmdbAssetSelect+" WHERE a.id = ? AND a.project_id = ?", id, scope.ProjectID)
	asset, err := scanCmdbAsset(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, errors.Join(ErrProjectScopedNotFound, sql.ErrNoRows)
	}
	if err != nil {
		return nil, nil, err
	}

	ifaces, err := s.getAssetInterfacesForProject(scope, id)
	if err != nil {
		return nil, nil, err
	}
	asset.Interfaces = ifaces
	return &asset, ifaces, nil
}

// InsertCmdbAsset 写入单条 CMDB 记录（支持全量 48+ 列）。
func (s *Store) InsertCmdbAsset(a *CmdbAsset) (int64, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.InsertCmdbAssetForProject(scope, a)
}

func (s *Store) InsertCmdbAssetForProject(scope ProjectScope, a *CmdbAsset) (int64, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	if a.Status == "" {
		a.Status = "在库"
	}
	if a.AssetClass == "" {
		a.AssetClass = "physical"
	}
	if a.SourceType == "" {
		a.SourceType = "manual"
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
	if a.Country == "" {
		a.Country = "中国"
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

	if len(a.CustomFields) > 0 {
		cfBytes, _ := json.Marshal(a.CustomFields)
		a.CustomFieldsJSON = string(cfBytes)
	}

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

	res, err := s.db.Exec(query,
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
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	a.ID = id
	a.ProjectID = scope.ProjectID
	if err := s.db.QueryRow("SELECT sync_id FROM cmdb_assets WHERE id = ? AND project_id = ?", id, scope.ProjectID).Scan(&a.SyncID); err != nil {
		return 0, err
	}
	return id, nil
}
