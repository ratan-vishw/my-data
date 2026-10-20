#include<iostream>
int main() {
  int n;
  std::cout<<"Enter the number: ";
  std::cin>>n;
  if (n%2==0){
    std::cout<<n<<" is a even number."<<std::endl;
  }else{
    std::cout<<n<<" is a odd number."<<std::endl;
  }
  return 0;
}