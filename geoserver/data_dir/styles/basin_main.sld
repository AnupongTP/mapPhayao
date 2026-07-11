<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0"
  xmlns="http://www.opengis.net/sld"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer>
    <Name>basin_main</Name>
    <UserStyle>
      <Title>Main Basin Boundaries</Title>
      <Abstract>Readable transparent style for dissolved main basin polygons.</Abstract>
      <FeatureTypeStyle>
        <Rule>
          <Name>main_basin_polygon</Name>
          <Title>Main basin polygon</Title>
          <PolygonSymbolizer>
            <Fill>
              <CssParameter name="fill">#3182BD</CssParameter>
              <CssParameter name="fill-opacity">0.05</CssParameter>
            </Fill>
            <Stroke>
              <CssParameter name="stroke">#08519C</CssParameter>
              <CssParameter name="stroke-width">2.5</CssParameter>
              <CssParameter name="stroke-linejoin">round</CssParameter>
            </Stroke>
          </PolygonSymbolizer>
        </Rule>
        <Rule>
          <Name>main_basin_label</Name>
          <Title>Main basin label</Title>
          <MaxScaleDenominator>250000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label>
              <ogc:PropertyName>basin_name</ogc:PropertyName>
            </Label>
            <Font>
              <CssParameter name="font-family">Tahoma</CssParameter>
              <CssParameter name="font-size">14</CssParameter>
              <CssParameter name="font-weight">bold</CssParameter>
            </Font>
            <LabelPlacement>
              <PointPlacement>
                <AnchorPoint>
                  <AnchorPointX>0.5</AnchorPointX>
                  <AnchorPointY>0.5</AnchorPointY>
                </AnchorPoint>
              </PointPlacement>
            </LabelPlacement>
            <Halo>
              <Radius>2</Radius>
              <Fill>
                <CssParameter name="fill">#FFFFFF</CssParameter>
              </Fill>
            </Halo>
            <Fill>
              <CssParameter name="fill">#08306B</CssParameter>
            </Fill>
            <VendorOption name="conflictResolution">true</VendorOption>
            <VendorOption name="goodnessOfFit">0.4</VendorOption>
            <VendorOption name="spaceAround">8</VendorOption>
          </TextSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
