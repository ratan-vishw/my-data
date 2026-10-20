const list = [{name: 'ratan',time:'7-10-2024'}];
      document.querySelector(".b1").addEventListener("click", function(){
        const content = document.querySelector(".in-1");
        const timeElement = document.querySelector(".todo-time");

        list.push({name: content.value,time: timeElement.value}); 
        content.value = "";
        timeElement.value = "";
        output();
      });

      output();

      
      function output(){
        const outText = document.querySelector(".out-text");
        outText.textContent = '';
        list.forEach(function(todoObject, index) {
          const {name, time} = todoObject;
          outText.innerHTML += `<p>${name} ${time} <button class="delete-list" data-index="${index}">DELETE</button></p>`;
        });
        deleting();
      }
      
      function deleting(){
        document.querySelectorAll(".delete-list").forEach(button => {button.addEventListener("click", function(){
          const i = this.getAttribute("data-index");
          list.splice(i, 1);
          output();
          });
        });
      }
