document.addEventListener("DOMContentLoaded", function(){
document.getElementById("submit").addEventListener("click", function(){
  const pi = 3.14;
  let circumference = 2 * pi * document.getElementById("input").value;
  console.log(circumference); 

  document.getElementById("output").textContent = circumference;
})
});