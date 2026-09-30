package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

type cmdbInterfaceAddress struct {
	IP      string      `json:"ip"`
	Purpose interface{} `json:"purpose"`
}

func validInterfacePurpose(purpose string) bool {
	return purpose == "management" || purpose == "business" || purpose == "out_of_band"
}

func normalizeInterfaceAddresses(iface *CmdbAssetInterface) error {
	iface.IP = strings.TrimSpace(iface.IP)
	var addresses []cmdbInterfaceAddress
	if err := json.Unmarshal([]byte(interfaceAdditionalIPs(*iface)), &addresses); err != nil || addresses == nil {
		return fmt.Errorf("接口 %s 的附加地址格式无效：必须是地址数组", iface.Name)
	}
	seen := map[string]int{}
	unique := make([]cmdbInterfaceAddress, 0, len(addresses))
	for _, address := range addresses {
		address.IP = strings.TrimSpace(address.IP)
		if address.IP == "" {
			return fmt.Errorf("接口 %s 的附加地址须包含 IP 和有效用途", iface.Name)
		}
		var purposes []string
		switch value := address.Purpose.(type) {
		case string:
			purposes = []string{value}
		case []interface{}:
			for _, item := range value {
				purpose, ok := item.(string)
				if !ok {
					return fmt.Errorf("接口 %s 的附加地址用途无效", iface.Name)
				}
				purposes = append(purposes, purpose)
			}
		default:
			return fmt.Errorf("接口 %s 的附加地址用途无效", iface.Name)
		}
		if len(purposes) == 0 {
			return fmt.Errorf("接口 %s 的附加地址用途无效", iface.Name)
		}
		for _, purpose := range purposes {
			if !validInterfacePurpose(purpose) {
				return fmt.Errorf("接口 %s 的附加地址用途无效", iface.Name)
			}
			if address.IP == iface.IP && iface.IsPrimary == 0 && purpose == "business" {
				continue
			}
			index, exists := seen[address.IP]
			if !exists {
				index = len(unique)
				seen[address.IP] = index
				unique = append(unique, cmdbInterfaceAddress{IP: address.IP, Purpose: []string{}})
			}
			current := unique[index].Purpose.([]string)
			found := false
			for _, existing := range current {
				if existing == purpose {
					found = true
					break
				}
			}
			if !found {
				current = append(current, purpose)
			}
			unique[index].Purpose = current
		}
	}
	for index := range unique {
		purposes := unique[index].Purpose.([]string)
		if len(purposes) == 1 {
			unique[index].Purpose = purposes[0]
		}
	}
	encoded, err := json.Marshal(unique)
	if err != nil {
		return err
	}
	iface.AdditionalIPsJSON = string(encoded)
	return nil
}

func interfaceAdditionalIPs(iface CmdbAssetInterface) string {
	if iface.AdditionalIPsJSON != "" {
		return iface.AdditionalIPsJSON
	}
	return "[]"
}

// 保存接口时维持编号，避免已有上下联链路引用失效。
func updateCmdbAssetInterfaces(tx *sql.Tx, projectID int64, asset *CmdbAsset, previous []CmdbAssetInterface, now string) error {
	existing := make(map[int64]CmdbAssetInterface, len(previous))
	retained := make(map[int64]bool, len(asset.Interfaces))
	for _, iface := range previous {
		existing[iface.ID] = iface
	}
	for _, iface := range asset.Interfaces {
		if iface.ID == 0 {
			continue
		}
		if _, ok := existing[iface.ID]; !ok {
			return fmt.Errorf("网络接口 %d 不属于当前资产，请重新打开后编辑", iface.ID)
		}
		if retained[iface.ID] {
			return fmt.Errorf("网络接口 %d 重复提交", iface.ID)
		}
		retained[iface.ID] = true
	}
	for _, iface := range previous {
		if retained[iface.ID] {
			continue
		}
		var count int
		if err := tx.QueryRow("SELECT COUNT(*) FROM cmdb_asset_links WHERE project_id=? AND local_asset_id=? AND local_interface_id=?", projectID, asset.ID, iface.ID).Scan(&count); err != nil {
			return err
		}
		if count > 0 {
			return fmt.Errorf("接口 %s 仍被上下联链路引用，请先解除链路后再删除接口", iface.Name)
		}
		if _, err := tx.Exec("DELETE FROM cmdb_asset_interfaces WHERE id=? AND asset_id=? AND project_id=?", iface.ID, asset.ID, projectID); err != nil {
			return err
		}
	}
	for index := range asset.Interfaces {
		iface := &asset.Interfaces[index]
		if err := normalizeInterfaceAddresses(iface); err != nil {
			return err
		}
		name, zone := iface.Name, iface.NetworkZone
		if name == "" {
			name = iface.IfName
		}
		if zone == "" {
			zone = iface.NetZone
		}
		if iface.ID != 0 {
			_, err := tx.Exec(`UPDATE cmdb_asset_interfaces SET asset_name=?, name=?, if_name=?, ip=?, additional_ips_json=?, mask=?, gateway=?, mac=?, network_zone=?, net_zone=?, is_primary=?, vlan_id=?, remark=?, updated_at=? WHERE id=? AND asset_id=? AND project_id=?`,
				asset.Name, name, name, iface.IP, interfaceAdditionalIPs(*iface), iface.Mask, iface.Gateway, iface.MAC, zone, zone, iface.IsPrimary, iface.VlanID, iface.Remark, now, iface.ID, asset.ID, projectID)
			if err != nil {
				return err
			}
		} else {
			result, err := tx.Exec(`INSERT INTO cmdb_asset_interfaces (project_id, asset_id, asset_name, name, if_name, ip, additional_ips_json, mask, gateway, mac, network_zone, net_zone, is_primary, vlan_id, remark, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				projectID, asset.ID, asset.Name, name, name, iface.IP, interfaceAdditionalIPs(*iface), iface.Mask, iface.Gateway, iface.MAC, zone, zone, iface.IsPrimary, iface.VlanID, iface.Remark, now, now)
			if err != nil {
				return err
			}
			iface.ID, err = result.LastInsertId()
			if err != nil {
				return err
			}
		}
	}
	return nil
}
