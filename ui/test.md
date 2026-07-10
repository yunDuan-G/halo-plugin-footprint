AMap.DistrictSearch
行政区查询服务（AMap.DistrictSearch）提供行政区信息的查询， 使用该服务可以获取到行政区域的区号、城市编码、中心点、边界、下辖区域等详细信息，为基于行政区域的地图功能提供支持。

new AMap.DistrictSearch(opts: DistrictSearchOptions, level: string, showbiz: boolean, extensions: string, subdistrict: number)
参数说明：
opts (DistrictSearchOptions) 默认参数
level (string) 关键字对应的行政区级别或商圈，可选值： country：国家 province：省/直辖市 city：市 district：区/县 biz_area：商圈
showbiz (boolean) 是否显示商圈，默认值true 可选为true/false，为了能够精准的定位到街道，特别是在快递、物流、送餐等场景下，强烈建议将此设置为false
extensions (string) 是否返回行政区边界坐标点，默认值：base，不返回行政区边界坐标点，取值：all，返回完整行政区边界坐标点
subdistrict (number) 显示下级行政区级数（行政区级别包括：国家、省/直辖市、市、区/县4个级别），商圈为区/县下一 级，可选值：0、1、2、3，默认值：1 0：不返回下级行政区 1：返回下一级行政区 2：返回下两级行政区 3：返回下三级行政区
示例代码：
AMap.plugin('AMap.DistrictSearch', function () {
var districtSearch = new AMap.DistrictSearch({
// 关键字对应的行政区级别，country表示国家
level: 'country',
//  显示下级行政区级数，1表示返回下一级行政区
subdistrict: 1
})
// 搜索所有省/直辖市信息
districtSearch.search('中国', function(status, result) {
// 查询成功时，result即为对应的行政区信息
})
})
// 除了获取所有省份/直辖市信息外，您可以通过修改level和subdistrict并配合search传入对应keyword查询对应信息。
静态方法：
setLevel(level)
设置关键字对应的行政区级别或商圈，可选值： country：国家 province：省/直辖市 city：市 district：区/县 biz_area：商圈

参数说明：
level (string) 设置级别
setSubdistrict(subdistrict)
设置下级行政区级数（行政区级别包括：国家、省/直辖市、市、区/县4个级别），商圈为区/县下一级，默认值：1 可选值：0、1、2、3 0：不返回下级行政区； 1：返回下一级行政区； 2：返回下两级行政区； 3：返回下三级行政区；

参数说明：
subdistrict (string) 下级行政区级数
search(keyword, DistrictSearchCallBack, keywords)
根据关键字查询行政区或商圈信息 关键字支持：行政区名、citycode、adcode、商圈名。默认值：“全国” 当status为complete时，result为DistrictSearchResult； 当status为error时，result为错误信息info； 当status为no_data时，代表检索返回0结果

参数说明：
keyword (any)
DistrictSearchCallBack (function (status: String, result: info/DistrictSearchResult)) 回调函数
keywords (string) 查询的关键字
事件：
complete
查询成功时触发此事件

返回值：
DistrictSearchResult:
error
当查询失败时触发此事件

返回值：
ErrorStatus:
