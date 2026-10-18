'use strict';

// Keep [longitude, latitude] at the adapter boundary; API 2.1 uses [lat, lon].
window.CityMaps = (() => {
  let sdkPromise;
  const unavailable = 'Карта не загрузилась. Проверьте интернет и обновите страницу.';

  async function load() {
    let response;
    try {
      response = await fetch(cityApiUrl('/api/map-config'), {cache:'no-store', signal:AbortSignal.timeout(10000)});
    } catch {
      throw new Error('Не удалось загрузить настройки карты с сервера. Попробуйте ещё раз.');
    }
    const config = await response.json();
    if (!response.ok) throw new Error(config.detail || unavailable);
    if (!config.api_key) {
      const error = new Error('Добавьте ключ доступа, чтобы показать карту Нерюнгри.');
      error.code = 'missing-key';
      throw error;
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => reject(new Error(unavailable)), 20000);
      const fail = () => {clearTimeout(timer); reject(new Error(unavailable));};
      script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(config.api_key)}&lang=ru_RU`;
      script.async = true;
      script.onerror = fail;
      script.onload = async () => {
        try {
          if (!window.ymaps) throw new Error('SDK unavailable');
          await new Promise((ready, failed) => window.ymaps.ready(ready, failed));
          clearTimeout(timer);
          resolve(window.ymaps);
        } catch {fail();}
      };
      document.head.append(script);
    });
  }

  return {
    ready() {return sdkPromise ||= load();},
    create(container, center, picker = false) {
      const map = new ymaps.Map(container, {
        center:[center[1],center[0]], zoom:14, controls:[],
        behaviors:picker ? ['drag','multiTouch','dblClickZoom'] : ['drag'],
      }, {minZoom:9,maxZoom:19,autoFitToViewport:'always',mapAutoFocus:false});
      return {
        get zoom(){return map.getZoom();},
        setZoomLocked(locked) {
          const gestures=['scrollZoom','multiTouch','dblClickZoom'];
          if(locked)map.behaviors.disable(gestures);
          else map.behaviors.enable(gestures);
        },
        addChild(entity){map.geoObjects.add(entity);},
        removeChild(entity){map.geoObjects.remove(entity);},
        onClick(callback){map.events.add('click',event=>{const [lat,lon]=event.get('coords');callback(lat,lon);});},
        setLocation({center,zoom,bounds,duration=0}) {
          if(bounds) {
            const [[west,north],[east,south]]=bounds;
            map.setBounds([[south,west],[north,east]],{checkZoomRange:true,duration});
          } else if(center)map.setCenter([center[1],center[0]],zoom ?? map.getZoom(),{duration});
          else if(zoom!==undefined)map.setZoom(zoom,{duration});
        },
      };
    },
    marker(coordinates, element) {
      const Layout = ymaps.templateLayoutFactory.createClass('<div class="city-marker-host"></div>', {
        build() {
          Layout.superclass.build.call(this);
          this.getParentElement().querySelector('.city-marker-host').append(element);
        },
      });
      return new ymaps.Placemark([coordinates[1],coordinates[0]],{}, {
        iconLayout:Layout,iconShape:{type:'Circle',coordinates:[0,0],radius:22},
        openBalloonOnClick:false,openHintOnHover:false,
      });
    },
    moveMarker(marker, coordinates) {
      marker.geometry.setCoordinates([coordinates[1],coordinates[0]]);
    },
  };
})();
