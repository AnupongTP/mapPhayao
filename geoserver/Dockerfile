FROM docker.osgeo.org/geoserver:2.28.2

# บังคับ Tomcat ให้รับการเชื่อมต่อจากทุก interface
# และใช้พอร์ตจาก Environment Variable PORT
RUN sed -i '0,/port="8080"/s//address="0.0.0.0" bindOnInit="true" port="${PORT}"/' \
    /opt/config/server.xml

COPY data_dir/ /opt/geoserver_data/

EXPOSE 8080